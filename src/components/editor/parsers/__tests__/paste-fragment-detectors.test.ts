import { BlockType } from '@/application/types';

import { parsePlainTextFragments } from '../paste-fragment-detectors';

describe('paste-fragment-detectors', () => {
  describe('parsePlainTextFragments', () => {
    const supportedMermaidStarts = [
      ['sequenceDiagram', 'sequenceDiagram\n    A->>B: Hello'],
      ['sequenceDiagram-v2', 'sequenceDiagram-v2\n    A->>B: Hello'],
      ['flowchart TD', 'flowchart TD\n    A --> B'],
      ['flowchart LR', 'flowchart LR\n    A --> B'],
      ['graph TD', 'graph TD\n    A --> B'],
      ['classDiagram', 'classDiagram\n    Animal <|-- Duck'],
      ['classDiagram-v2', 'classDiagram-v2\n    Animal <|-- Duck'],
      ['stateDiagram-v2', 'stateDiagram-v2\n    [*] --> Still'],
      ['erDiagram', 'erDiagram\n    CUSTOMER ||--o{ ORDER : places'],
      ['journey', 'journey\n    title My working day'],
      ['gantt', 'gantt\n    title Project timeline'],
      ['pie', 'pie\n    title Pets'],
      ['mindmap', 'mindmap\n    root((mindmap))'],
      ['timeline', 'timeline\n    title History'],
      ['gitGraph', 'gitGraph\n    commit'],
      ['quadrantChart', 'quadrantChart\n    title Reach and engagement'],
      ['requirementDiagram', 'requirementDiagram\n    requirement test_req'],
      ['C4Context', 'C4Context\n    title System context'],
      ['C4Container', 'C4Container\n    title Container diagram'],
      ['C4Component', 'C4Component\n    title Component diagram'],
      ['C4Dynamic', 'C4Dynamic\n    title Dynamic diagram'],
      ['C4Deployment', 'C4Deployment\n    title Deployment diagram'],
      ['packet-beta', 'packet-beta\n    0-15: "Source Port"'],
      ['block-beta', 'block-beta\n    columns 3'],
      ['architecture-beta', 'architecture-beta\n    group api(cloud)[API]'],
      ['xychart-beta', 'xychart-beta\n    title "Sales Revenue"'],
      ['sankey-beta', 'sankey-beta\n    source,target,value'],
    ] as const;

    it('returns null when no special fragment is detected', () => {
      const blocks = parsePlainTextFragments('First pasted line\nSecond pasted line');

      expect(blocks).toBeNull();
    });

    it.each(supportedMermaidStarts)('detects supported Mermaid start: %s', (_name, diagram) => {
      const blocks = parsePlainTextFragments(diagram);

      expect(blocks).toHaveLength(1);
      expect(blocks?.[0]).toMatchObject({
        type: BlockType.CodeBlock,
        data: { language: 'mermaid' },
      });
      expect(blocks?.[0].text).toBe(diagram);
    });

    it('detects an unfenced Mermaid sequence diagram', () => {
      const blocks = parsePlainTextFragments(`
sequenceDiagram
    participant Client as Browser client
    participant Server as Application server
    Client->>Server: send request
      `.trim());

      expect(blocks).toHaveLength(1);
      expect(blocks?.[0]).toMatchObject({
        type: BlockType.CodeBlock,
        data: { language: 'mermaid' },
      });
      expect(blocks?.[0].text).toContain('sequenceDiagram');
      expect(blocks?.[0].text).toContain('Client->>Server');
    });

    it('keeps one simulated sequence diagram across blank lines inside the diagram', () => {
      const blocks = parsePlainTextFragments(`
1. Simulated Async Handoff

sequenceDiagram
    participant Client as Browser client
    participant Server as Application server
    participant Worker as Background worker

    Client->>Server: submit request
    Server->>Worker: assign task

    Worker-->>Server: report completion
    Note over Server,Worker: status is shown in dashboard

After diagram
      `.trim());

      expect(blocks?.map((block) => block.type)).toEqual([
        BlockType.NumberedListBlock,
        BlockType.CodeBlock,
        BlockType.Paragraph,
      ]);
      expect(blocks?.[1].data).toEqual({ language: 'mermaid' });
      expect(blocks?.[1].text).toContain('Client->>Server');
      expect(blocks?.[1].text).toContain('Worker-->>Server');
      expect(blocks?.[1].text).toContain('Note over Server,Worker');
      expect(blocks?.[2].text).toBe('After diagram');
    });

    it('splits mixed prose and Mermaid fragments into extensible parsed blocks', () => {
      const blocks = parsePlainTextFragments(`
sequenceDiagram
    participant Client as Browser client
    participant Server as Application server
    Client->>Server: send request

Context: this paragraph should stay outside the diagram.

Next shape:

flowchart TD
    A[Start] --> B{Continue?}
    B -- No --> C[Stop]
      `.trim());

      expect(blocks?.map((block) => block.type)).toEqual([
        BlockType.CodeBlock,
        BlockType.Paragraph,
        BlockType.Paragraph,
        BlockType.CodeBlock,
      ]);
      expect(blocks?.[0].data).toEqual({ language: 'mermaid' });
      expect(blocks?.[1].text).toBe('Context: this paragraph should stay outside the diagram.');
      expect(blocks?.[2].text).toBe('Next shape:');
      expect(blocks?.[3].data).toEqual({ language: 'mermaid' });
      expect(blocks?.[3].text).toContain('flowchart TD');
    });

    it('supports prose before and after an unfenced Mermaid fragment', () => {
      const blocks = parsePlainTextFragments(`
Before diagram

flowchart TD
    A[Start] --> B{Continue?}

After diagram
      `.trim());

      expect(blocks?.map((block) => block.type)).toEqual([
        BlockType.Paragraph,
        BlockType.CodeBlock,
        BlockType.Paragraph,
      ]);
      expect(blocks?.[0].text).toBe('Before diagram');
      expect(blocks?.[1].data).toEqual({ language: 'mermaid' });
      expect(blocks?.[2].text).toBe('After diagram');
    });

    it('keeps Markdown prose chunks when a Mermaid fragment is present', () => {
      const blocks = parsePlainTextFragments(`
## Simulated Flow

flowchart TD
    A --> B

- first follow-up item
- second follow-up item
      `.trim());

      expect(blocks?.map((block) => block.type)).toEqual([
        BlockType.HeadingBlock,
        BlockType.CodeBlock,
        BlockType.BulletedListBlock,
        BlockType.BulletedListBlock,
      ]);
      expect(blocks?.[0].text).toBe('Simulated Flow');
      expect(blocks?.[1].data).toEqual({ language: 'mermaid' });
      expect(blocks?.[2].text).toBe('first follow-up item');
      expect(blocks?.[3].text).toBe('second follow-up item');
    });

    it('keeps TSV chunks when a Mermaid fragment is present', () => {
      const blocks = parsePlainTextFragments(
        'Name\tStatus\nExample\tReady\n\nsequenceDiagram\n    Client->>Server: send request'
      );

      expect(blocks?.map((block) => block.type)).toEqual([
        BlockType.SimpleTableBlock,
        BlockType.CodeBlock,
      ]);
      expect(blocks?.[1].data).toEqual({ language: 'mermaid' });
    });

    it('keeps fenced code chunks when an unfenced Mermaid fragment is present', () => {
      const blocks = parsePlainTextFragments(`
\`\`\`mermaid
sequenceDiagram
    Client->>Server: send request
\`\`\`

flowchart TD
    A --> B
      `.trim());

      expect(blocks?.map((block) => block.type)).toEqual([
        BlockType.CodeBlock,
        BlockType.CodeBlock,
      ]);
      expect(blocks?.[0].data).toEqual({ language: 'mermaid' });
      expect(blocks?.[0].text).toContain('sequenceDiagram');
      expect(blocks?.[1].data).toEqual({ language: 'mermaid' });
      expect(blocks?.[1].text).toContain('flowchart TD');
    });

    it('does not treat a lone Mermaid keyword as a diagram', () => {
      const blocks = parsePlainTextFragments('sequenceDiagram');

      expect(blocks).toBeNull();
    });

    it('does not treat prose mentioning a Mermaid keyword as a diagram', () => {
      const blocks = parsePlainTextFragments(
        'The flowchart TD direction is useful when writing Mermaid diagrams.'
      );

      expect(blocks).toBeNull();
    });

    it('dedents Mermaid fragments copied with shared indentation', () => {
      const blocks = parsePlainTextFragments(`
        flowchart TD
          A[Start] --> B{Continue?}
          B --> C[Done]
      `);

      expect(blocks).toHaveLength(1);
      expect(blocks?.[0].text.startsWith('flowchart TD')).toBe(true);
      expect(blocks?.[0].text).toContain('  A[Start]');
    });

    it('supports Mermaid init directives before the diagram start', () => {
      const blocks = parsePlainTextFragments(`
%%{init: {"theme": "base"}}%%
flowchart LR
    A --> B
      `.trim());

      expect(blocks).toHaveLength(1);
      expect(blocks?.[0].data).toEqual({ language: 'mermaid' });
      expect(blocks?.[0].text).toContain('%%{init');
      expect(blocks?.[0].text).toContain('flowchart LR');
    });

    it('supports Mermaid comments before the diagram start', () => {
      const blocks = parsePlainTextFragments(`
%% Paste source: synthetic fixture
flowchart LR
    A --> B
      `.trim());

      expect(blocks).toHaveLength(1);
      expect(blocks?.[0].data).toEqual({ language: 'mermaid' });
      expect(blocks?.[0].text).toContain('%% Paste source');
      expect(blocks?.[0].text).toContain('flowchart LR');
    });

    it('splits fragments with Windows line endings', () => {
      const blocks = parsePlainTextFragments(
        'flowchart TD\r\n    A --> B\r\n\r\nAfter diagram'
      );

      expect(blocks?.map((block) => block.type)).toEqual([
        BlockType.CodeBlock,
        BlockType.Paragraph,
      ]);
      expect(blocks?.[0].text).toContain('A --> B');
      expect(blocks?.[1].text).toBe('After diagram');
    });
  });
});
