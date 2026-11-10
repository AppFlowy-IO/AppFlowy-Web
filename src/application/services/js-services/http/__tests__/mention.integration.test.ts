/**
 * @jest-environment node
 *
 * Integration tests for the workspace mention search API.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
    BlockType,
    MentionSearchRequest,
    MentionSearchResponse,
    MentionSearchResultItem,
    MentionSearchSectionKind,
    MentionTargetKind,
    MentionType,
    ViewLayout,
} from '@/application/types';
import {
    MENTION_UNMATCHED_SERVER_TIER,
    objectTier,
    retierServerSection,
} from '@/components/editor/components/panels/mention-panel/mentionLocalRanker';
import {
    APIService,
    AuthHelper,
    FeatureFixtureAccount,
    getEnvConfig,
    getFeatureFixtureAccount,
    initAPIService,
    setActiveTestToken,
} from './setup';
import {
    isMentionSessionMetricsAdvertised,
    MentionPickerSession,
    reportMentionPickerSession,
} from '../mention-presentation-metrics';
import type { ServerInfoState } from '@/utils/server-info';
import { v4 as uuidv4 } from 'uuid';

const FEATURE_NAME = 'mention-api';
const MEMBER_DISPLAY_NAME = 'Mention API Fixture Member';
const SEARCH_POLL_TIMEOUT_MS = 60000;
const SEARCH_POLL_INTERVAL_MS = 1500;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function section(response: MentionSearchResponse, kind: MentionSearchSectionKind) {
    return response.sections.find((section) => section.kind === kind);
}

function allItems(response: MentionSearchResponse): MentionSearchResultItem[] {
    return response.sections.flatMap((section) => section.items);
}

async function waitForMentionItem(
    workspaceId: string,
    request: MentionSearchRequest,
    predicate: (item: MentionSearchResultItem) => boolean
) {
    const startedAt = Date.now();
    let lastResponse: MentionSearchResponse | undefined;

    while (Date.now() - startedAt < SEARCH_POLL_TIMEOUT_MS) {
        lastResponse = await APIService.searchMentions(workspaceId, request);
        const item = allItems(lastResponse).find(predicate);

        if (item) {
            return { item, response: lastResponse };
        }

        await sleep(SEARCH_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for mention item. Last response: ${JSON.stringify(lastResponse)}`);
}

async function ensureMemberJoinedWorkspace(
    owner: FeatureFixtureAccount,
    member: FeatureFixtureAccount,
    workspaceId: string
) {
    setActiveTestToken(owner.token);

    const createdInvite = await APIService.createWorkspaceInviteCode(workspaceId, 24);
    const inviteCode = createdInvite.code ?? (await APIService.getWorkspaceInviteCode(workspaceId)).code;

    if (!inviteCode) {
        throw new Error('Workspace invite code was not created');
    }

    setActiveTestToken(member.token);

    const workspaceInfo = await APIService.getUserWorkspaceInfo();
    const alreadyJoined = workspaceInfo.workspaces.some((workspace) => workspace.id === workspaceId);

    if (!alreadyJoined) {
        await APIService.joinWorkspaceByInvitationCode(inviteCode);
    }

    await APIService.updateWorkspaceMemberProfile(workspaceId, {
        name: MEMBER_DISPLAY_NAME,
    });
}

describe('HTTP API - Mention Search', () => {
    let debugSpy: jest.SpiedFunction<typeof console.debug>;
    let owner: FeatureFixtureAccount;
    let member: FeatureFixtureAccount;
    // Not a member of the owner's workspace.
    let outsider: FeatureFixtureAccount;
    let workspaceId: string;
    let contextPageId: string;
    let searchablePageName: string;
    let searchablePageQuery: string;
    let memberUserId: string;

    beforeAll(() => {
        debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    });

    afterAll(() => {
        debugSpy.mockRestore();
    });

    beforeAll(async () => {
        const envConfig = getEnvConfig();
        const authHelper = new AuthHelper(envConfig.gotrueURL);

        initAPIService({
            baseURL: envConfig.baseURL,
            gotrueURL: envConfig.gotrueURL,
            wsURL: envConfig.wsURL,
        });

        owner = await getFeatureFixtureAccount(authHelper, FEATURE_NAME, 'owner');
        member = await getFeatureFixtureAccount(authHelper, FEATURE_NAME, 'member');
        outsider = await getFeatureFixtureAccount(authHelper, FEATURE_NAME, 'outsider');
        workspaceId = owner.workspaceId;

        await ensureMemberJoinedWorkspace(owner, member, workspaceId);

        setActiveTestToken(member.token);
        memberUserId = (await APIService.getCurrentUser(workspaceId)).uuid;

        setActiveTestToken(owner.token);
        const { outline } = await APIService.getAppOutline(workspaceId);
        const rootViewId = outline[0]?.view_id || workspaceId;

        searchablePageQuery = `mention-http-${uuidv4().slice(0, 8)}`;
        searchablePageName = `Mention HTTP ${searchablePageQuery}`;
        const { view_id } = await APIService.addAppPage(workspaceId, rootViewId, {
            layout: ViewLayout.Document,
            name: searchablePageName,
        });

        contextPageId = view_id;
        await APIService.addRecentPages(workspaceId, [contextPageId]);
    }, 120000);

    beforeEach(() => {
        setActiveTestToken(owner.token);
    });

    it('returns empty-query defaults without links or global database rows', async () => {
        const response = await APIService.searchMentions(workspaceId, {
            query: '',
            limit: 8,
            include: [
                MentionTargetKind.Person,
                MentionTargetKind.Page,
                MentionTargetKind.DatabaseRow,
                MentionTargetKind.Date,
                MentionTargetKind.ExternalLink,
            ],
            context: {
                view_id: contextPageId,
            },
        });

        expect(Array.isArray(response.sections)).toBe(true);
        response.sections.forEach((section) => {
            expect(section.items.length).toBeLessThanOrEqual(8);
        });

        expect(section(response, MentionSearchSectionKind.Links)).toBeUndefined();
        expect(section(response, MentionSearchSectionKind.DatabaseRows)?.items ?? []).toHaveLength(0);

        const dates = section(response, MentionSearchSectionKind.Dates);

        expect(dates?.items.some((item) => item.title === 'Today')).toBe(true);
        expect(dates?.items.some((item) => item.title === 'Tomorrow')).toBe(true);
    }, 30000);

    it('filters people by keyword using the reusable member fixture account', async () => {
        const { item } = await waitForMentionItem(
            workspaceId,
            {
                query: MEMBER_DISPLAY_NAME,
                limit: 8,
                include: [MentionTargetKind.Person],
                context: {
                    view_id: contextPageId,
                },
            },
            (item) => item.kind === MentionTargetKind.Person && item.object_id === memberUserId
        );

        expect(item.title).toBe(MEMBER_DISPLAY_NAME);
        expect(item.subtitle).toBe(member.email);
        expect(item.can_access_context).toBe(true);
        expect(item.mention).toMatchObject({
            type: MentionTargetKind.Person,
            person_id: memberUserId,
            person_name: MEMBER_DISPLAY_NAME,
            page_id: contextPageId,
        });
    }, 70000);

    it('returns the seeded recent fixture page for empty mention queries', async () => {
        const response = await APIService.searchMentions(workspaceId, {
            query: '',
            limit: 8,
            include: [MentionTargetKind.Page],
            context: {
                view_id: contextPageId,
            },
        });
        const item = section(response, MentionSearchSectionKind.Pages)?.items.find(
            (item) => item.kind === MentionTargetKind.Page && item.title === searchablePageName
        );

        expect(item).toBeDefined();
        expect(item?.mention).toMatchObject({
            type: MentionTargetKind.Page,
            page_id: contextPageId,
        });
    }, 30000);

    it('returns normalized external link suggestions only for URL-like keywords', async () => {
        const response = await APIService.searchMentions(workspaceId, {
            query: 'example.com',
            limit: 8,
            include: [MentionTargetKind.ExternalLink, MentionTargetKind.Date],
        });

        const links = section(response, MentionSearchSectionKind.Links);

        expect(links?.items).toHaveLength(1);
        expect(links?.items[0].mention).toEqual({
            type: MentionType.externalLink,
            url: 'https://example.com',
        });
        expect(section(response, MentionSearchSectionKind.Dates)).toBeUndefined();
    }, 30000);

    // The server tiers typed Pages by their current title (MEN-SEARCH-08) with the matcher the Web
    // ranker ports (MEN-WEB-06), so re-tiering the server's own answer on the client moves nothing,
    // and a page found only through its body sits below every title match.
    it('agrees with the client ranker on the title tiers of a typed Pages answer', async () => {
        const token = `retier${uuidv4().replace(/-/g, '').slice(0, 10)}`;
        const { outline } = await APIService.getAppOutline(workspaceId);
        const rootViewId = outline[0]?.view_id || workspaceId;
        // Exact, prefix, word start and substring: T0 to T3.
        const titles = [token, `${token} 2026`, `Notes ${token}`, `x${token}`];
        const titledIds: string[] = [];

        for (const name of titles) {
            const { view_id } = await APIService.addAppPage(workspaceId, rootViewId, {
                layout: ViewLayout.Document,
                name,
            });

            titledIds.push(view_id);
        }

        const { view_id: bodyPageId } = await APIService.addAppPage(workspaceId, rootViewId, {
            layout: ViewLayout.Document,
            name: `Weekly sync ${uuidv4().slice(0, 8)}`,
            page_data: {
                type: BlockType.Page,
                children: [
                    {
                        type: BlockType.Paragraph,
                        data: { delta: [{ insert: `Agenda: ${token} review` }] },
                        children: [],
                    },
                ],
            },
        });

        // Recent views reach the recent lane before the keyword index has the new titles.
        await APIService.addRecentPages(workspaceId, titledIds);

        const { response } = await waitForMentionItem(
            workspaceId,
            {
                query: token,
                limit: 8,
                include: [MentionTargetKind.Page],
                context: { view_id: contextPageId },
            },
            (item) => item.object_id === bodyPageId
        );
        const pages = section(response, MentionSearchSectionKind.Pages);

        expect(pages).toBeDefined();
        if (!pages) return;

        const tiers = pages.items.map((item) => objectTier(token, item.title) ?? MENTION_UNMATCHED_SERVER_TIER);

        expect(tiers).toEqual([...tiers].sort((left, right) => left - right));
        expect(retierServerSection(token, pages)).toBe(pages);
        expect(tiers[pages.items.findIndex((item) => item.object_id === bodyPageId)]).toBe(MENTION_UNMATCHED_SERVER_TIER);

        const seeded = pages.items
            .map((item) => titledIds.indexOf(item.object_id ?? ''))
            .filter((index) => index !== -1);

        expect(seeded[0]).toBe(0);
        expect(seeded).toEqual([...seeded].sort((left, right) => left - right));
    }, 120000);

    describe('picker session reports (MEN-CLOUD-05)', () => {
        const session: MentionPickerSession = {
            trigger: 'at',
            outcome: 'selected',
            query_len: 4,
            selected_rank: 3,
            selected_section: 'pages',
            selected_source: 'server',
            time_to_first_paint_ms: 40,
            time_to_select_ms: 1_200,
            server_ms: 160,
            requests_sent: 3,
            requests_aborted: 0,
            zero_result_shown: false,
        };
        let serverInfo: ServerInfoState;

        beforeAll(async () => {
            serverInfo = { status: 'available', info: await APIService.getServerInfo() };
        });

        // Servers without MEN-CLOUD-05, and self-hosted ones without
        // APPFLOWY_MENTION_SESSION_METRICS=true, advertise nothing, and the Web never calls them.
        function advertised() {
            const offered = isMentionSessionMetricsAdvertised(serverInfo);

            if (!offered) console.warn('Skipped: this server does not advertise session_metrics_v1');
            return offered;
        }

        it('takes a member report as the Web builds it, and a dismissed one without selection fields', async () => {
            if (!advertised()) return;

            setActiveTestToken(member.token);
            await expect(reportMentionPickerSession(workspaceId, session, serverInfo)).resolves.toBe('sent');
            await expect(
                reportMentionPickerSession(
                    workspaceId,
                    { ...session, outcome: 'dismissed', trigger: 'page_link', zero_result_shown: true },
                    serverInfo
                )
            ).resolves.toBe('sent');
        }, 30000);

        it("refuses a report to a workspace the user is not a member of, inside HTTP 200", async () => {
            if (!advertised()) return;

            setActiveTestToken(outsider.token);
            await expect(reportMentionPickerSession(workspaceId, session, serverInfo)).resolves.toBe('refused');
        }, 30000);
    });
});
