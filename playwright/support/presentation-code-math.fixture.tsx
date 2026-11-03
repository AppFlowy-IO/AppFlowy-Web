import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Element } from 'slate';

import AppTheme from '@/components/main/AppTheme';
import DocumentPresenter from '@/components/presentation/DocumentPresenter';
import { snapshotFromSlate } from '@/components/presentation/snapshot-adapter';
import '@/styles/global.css';

const block = (id: string, type: string, text: string, data = {}) =>
  ({
    blockId: id,
    type,
    data,
    children: [{ type: 'text', children: [{ text }] }],
  } as Element);
const heading = (text: string) => block(text, 'heading', text, { level: 2 });
const equation = (id: string, formula: string) => block(id, 'math_equation', '', { formula });
const typescript =
  'interface Person {\n  name: string;\n}\n\nconst greet = (person: Person): string => {\n  return `Hello, ${person.name}`;\n};';
const python =
  'def total(values):\n    # Keep the original indentation\n    return sum(value ** 2 for value in values)\n\nprint(total([1, 2, 3]))';
const longLine = `const longLine = "${'Keep every character. '.repeat(35)}THE_END";`;
const source = {
  type: 'page',
  children: [
    heading('Equations'),
    equation('fraction', String.raw`\frac{-b \pm \sqrt{b^2-4ac}}{2a}`),
    equation('matrix', String.raw`A = \begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}`),
    equation('multiline', 'x = 1\ny = 2'),
    block('after-math', 'paragraph', 'Equations retain their original mathematical structure.'),
    heading('TypeScript'),
    block('ts-code', 'code', typescript, { language: 'typescript' }),
    heading('Python'),
    block('py-code', 'code', python, { language: 'python' }),
    heading('Wide content'),
    equation('wide-equation', `a=${Array.from({ length: 70 }, (_, i) => `x_{${i}}`).join('+')}`),
    block('wide-code', 'code', longLine, { language: 'javascript' }),
    heading('Plain source'),
    block('unknown-code', 'code', '<script>window.presentationInjected = true</script>\n\tUntouched whitespace', {
      language: 'future-language',
    }),
    heading('Diagram'),
    block('diagram-code', 'code', 'graph LR\n  A[Source document] --> B[Presentation]\n  B --> C[Read only]', {
      language: 'mermaid',
    }),
    heading('Invalid equation'),
    equation('invalid', String.raw`\notARealCommand{broken}`),
    block('after-invalid', 'paragraph', 'The rest of the document remains readable.'),
    heading('Finished'),
    block('finish', 'paragraph', 'Every source block is preserved.'),
  ],
} as Element;
const snapshot = snapshotFromSlate('code-math', 'Code and equations', source);
const original = JSON.stringify(snapshot);
function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <AppTheme>
      <button onClick={() => setOpen(true)}>Present document</button>
      {open && (
        <DocumentPresenter
          snapshot={snapshot}
          onClose={() => {
            setOpen(false);
            document.documentElement.dataset.unchanged = String(original === JSON.stringify(snapshot));
          }}
          onSource={() => setOpen(false)}
        />
      )}
    </AppTheme>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
