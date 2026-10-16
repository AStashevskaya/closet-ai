import 'i18next';

import type { resources } from './index';

// Types t() keys from the Russian file, so a missing or misspelled key fails typecheck.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: (typeof resources)['ru'];
  }
}
