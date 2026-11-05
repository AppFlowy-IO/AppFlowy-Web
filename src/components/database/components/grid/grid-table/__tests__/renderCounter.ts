import { type ComponentType, type FunctionComponent, memo, type MemoExoticComponent } from 'react';

const MEMO_TYPE = Symbol.for('react.memo');

type MemoComponent = MemoExoticComponent<FunctionComponent<object>> & {
  type: FunctionComponent<object>;
  compare?: (previous: object, next: object) => boolean;
};

function isMemo(component: unknown): component is MemoComponent {
  return (component as { $$typeof?: symbol } | null)?.$$typeof === MEMO_TYPE;
}

/**
 * A component module whose default export counts its renders (`renders`) and is
 * memoized exactly as the real one is: an unmemoized component stays
 * unmemoized, so a lost `memo` shows up as renders. For `jest.mock` factories.
 */
export function countDefaultExportRenders<Module extends { default: ComponentType<never> }>(actual: Module) {
  const component = actual.default as unknown;
  const render = (isMemo(component) ? component.type : component) as FunctionComponent<object>;
  const renders = jest.fn();
  const Counted = (props: object) => {
    renders();

    return render(props);
  };

  return {
    ...actual,
    __esModule: true,
    default: isMemo(component) ? memo(Counted, component.compare) : Counted,
    renders,
  };
}
