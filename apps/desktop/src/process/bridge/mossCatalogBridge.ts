import { mossCatalog, skillHub } from '@sudowork/host-bridge/ipcBridge';
import { detailMossCatalog, listMossCatalog, requestMossCatalog, mossCatalogIdentity, assertMossCatalogIdentity } from '@process/services/mossCatalogApi';
import { getMossCatalogInstallations, installMossCatalog, changeCatalogInstallation, detailLocalMossCatalog } from '@process/services/mossCatalogInstall';
import { AcpSkillManager } from '@process/task/AcpSkillManager';

async function respond<T>(work: () => Promise<T>) {
  try {
    return { success: true, data: await work() };
  } catch (error) {
    return { success: false, msg: error instanceof Error ? error.message : String(error) };
  }
}

function onChanged() {
  AcpSkillManager.resetInstance();
  mossCatalog.changed.emit();
  skillHub.changed.emit({ source: 'hub' });
}

let isWatching = false;
async function watchPublications() {
  if (isWatching) return;
  isWatching = true;
  for (;;) {
    try {
      const identity = mossCatalogIdentity();
      const response = await requestMossCatalog('/api/v1/client/catalog/events');
      if (!response.body) throw new Error('Missing catalog stream');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          assertMossCatalogIdentity(identity);
          buffer += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (frame.includes('event: catalog.changed')) onChanged();
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch {
      // Offline and account changes retry with the current authenticated identity.
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      timer.unref();
    });
  }
}

export function initMossCatalogBridge() {
  mossCatalog.list.provider((input) => {
    void watchPublications();
    return respond(() => listMossCatalog(input));
  });
  mossCatalog.detail.provider((input) => respond(() => (input.isLocal ? detailLocalMossCatalog(input) : detailMossCatalog(input))));
  mossCatalog.installed.provider(() => respond(getMossCatalogInstallations));
  mossCatalog.install.provider((input) =>
    respond(async () => {
      const installed = await installMossCatalog(input);
      onChanged();
      return installed;
    })
  );
  mossCatalog.remove.provider((input) =>
    respond(async () => {
      await changeCatalogInstallation(input);
      onChanged();
    })
  );
  mossCatalog.setEnabled.provider((input) =>
    respond(async () => {
      await changeCatalogInstallation(input);
      onChanged();
    })
  );
}
