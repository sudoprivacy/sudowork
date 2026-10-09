import { mossCatalog, skillHub } from '@sudowork/host-bridge/ipcBridge';
import { detailMossCatalog, listMossCatalog } from '@process/services/mossCatalogApi';
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

export function initMossCatalogBridge() {
  mossCatalog.list.provider((input) => respond(() => listMossCatalog(input)));
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
