import brand from '@brand';

export const IS_OFFLINE_BUILD = brand.BUILD_OFFLINE === true;
export const IS_SHAREONE_DISABLED = (brand as { disabledFeatures?: string[] }).disabledFeatures?.includes('shareone') === true;
