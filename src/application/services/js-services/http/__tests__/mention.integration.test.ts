/**
 * @jest-environment node
 *
 * Integration tests for the workspace mention search API.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
    MentionSearchRequest,
    MentionSearchResponse,
    MentionSearchResultItem,
    MentionSearchSectionKind,
    MentionTargetKind,
    MentionType,
    ViewLayout,
} from '@/application/types';
import {
    APIService,
    AuthHelper,
    FeatureFixtureAccount,
    getEnvConfig,
    getFeatureFixtureAccount,
    initAPIService,
    setActiveTestToken,
} from './setup';
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
});
