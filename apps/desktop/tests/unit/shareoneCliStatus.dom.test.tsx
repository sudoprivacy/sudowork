import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareoneCliStatusProvider, useShareoneCliInstalled } from '@renderer/messages/ShareoneCliStatusContext';
import TurnActions from '@renderer/messages/TurnActions';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), on: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  shareoneCli: { checkInstalled: { invoke: bridge.invoke }, installResult: { on: bridge.on } },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function Footer() {
  return <span>{useShareoneCliInstalled() ? 'installed' : 'unavailable'}</span>;
}

function History({ generation }: IHistoryProps) {
  return (
    <ShareoneCliStatusProvider>
      {Array.from({ length: 20 }, (_, index) => (
        <React.Fragment key={`${generation}-${index}`}>
          <Footer />
          <TurnActions turnTexts={['Assistant response']} turnTextsRaw={['Assistant response']} />
        </React.Fragment>
      ))}
    </ShareoneCliStatusProvider>
  );
}

describe('ShareOne discovery for virtualized conversation footers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.on.mockReturnValue(bridge.unsubscribe);
    bridge.invoke.mockResolvedValue({ success: true, data: { installed: true } });
  });
  afterEach(cleanup);

  it('shares one probe across hundreds of footer remounts', async () => {
    const history = render(<History generation={0} />);
    await waitFor(() => expect(screen.getAllByText('installed')).toHaveLength(20));
    for (let generation = 1; generation <= 30; generation++) history.rerender(<History generation={generation} />);
    expect(screen.getAllByText('installed')).toHaveLength(20);
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    expect(bridge.on).toHaveBeenCalledTimes(1);
    history.unmount();
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('updates visible footers on installation and ignores an older discovery result', async () => {
    let finishOld!: (value: unknown) => void;
    bridge.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    );
    render(<History generation={0} />);
    await act(async () => {
      bridge.on.mock.calls[0][0]({ success: true });
    });
    expect(screen.getAllByText('installed')).toHaveLength(20);
    await act(async () => {
      finishOld({ success: true, data: { installed: false } });
    });
    expect(screen.getAllByText('installed')).toHaveLength(20);
    expect(bridge.invoke).toHaveBeenCalledTimes(2);
  });

  it('keeps failed discovery unavailable without repeated footer probes', async () => {
    bridge.invoke.mockRejectedValue(new Error('CLI discovery failed'));
    const history = render(<History generation={0} />);
    await act(async () => {});
    history.rerender(<History generation={1} />);
    expect(screen.getAllByText('unavailable')).toHaveLength(20);
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
  });
});

interface IHistoryProps {
  generation: number;
}
