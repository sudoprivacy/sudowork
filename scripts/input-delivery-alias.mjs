import { fileURLToPath } from 'node:url';

// Both hosts bundle native input delivery from source, even before the shared
// packages have a dist build. Keep main and renderer resolution in agreement.
export const inputDeliveryAliases = [
  {
    find: '@sudowork/contracts/input-delivery',
    replacement: fileURLToPath(new URL('../packages/contracts/src/inputDelivery.ts', import.meta.url)),
  },
  {
    find: '@sudowork/moss-client/input-delivery',
    replacement: fileURLToPath(new URL('../packages/moss-client/src/InputDeliveryClient.ts', import.meta.url)),
  },
];
