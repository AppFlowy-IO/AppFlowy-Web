import { render } from '@testing-library/react';

import { Tooltip, TooltipContent, TooltipGroupProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** The `delayDuration` of every tooltip provider mounted. */
const mockProviderDelays: (number | undefined)[] = [];

jest.mock('@radix-ui/react-tooltip', () => {
  const actual = jest.requireActual('@radix-ui/react-tooltip');

  return {
    ...actual,
    Provider: (props: { delayDuration?: number }) => {
      mockProviderDelays.push(props.delayDuration);
      return <actual.Provider {...props} />;
    },
  };
});

function rowTooltips(count: number, delayDuration?: number) {
  return Array.from({ length: count }, (_, index) => (
    <Tooltip key={index} delayDuration={delayDuration}>
      <TooltipTrigger>{`Row ${index}`}</TooltipTrigger>
      <TooltipContent>Open menu</TooltipContent>
    </Tooltip>
  ));
}

describe('Tooltip providers (W8)', () => {
  beforeEach(() => {
    mockProviderDelays.length = 0;
  });

  it('mounts one provider per tooltip outside a group, as before', () => {
    render(<>{rowTooltips(18)}</>);

    expect(mockProviderDelays).toEqual(Array(18).fill(0));
  });

  it('shares one provider, with the same 0 ms delay, between the tooltips of a view', () => {
    render(<TooltipGroupProvider>{rowTooltips(18)}</TooltipGroupProvider>);

    expect(mockProviderDelays).toEqual([0]);
  });

  it('keeps its own provider for a tooltip with its own delay, so no other tooltip shortens it', () => {
    render(
      <TooltipGroupProvider>
        {rowTooltips(3)}
        {rowTooltips(2, 500)}
      </TooltipGroupProvider>
    );

    // The group's provider, and one each for the two tooltips with a 500 ms delay.
    expect(mockProviderDelays).toEqual([0, 0, 0]);
  });
});
