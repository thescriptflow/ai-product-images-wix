import type { FC, ReactNode } from 'react';
import { i18n } from '@wix/essentials';
import {
  WixDesignSystemProvider,
  WixDesignSystemIconThemeProvider,
  WixDesignSystemDefaultPropsProvider,
  type WixDesignSystemDefaultProps,
} from '@wix/design-system';
import { IconThemeProvider } from '@wix/wix-ui-icons-common/core';
import '@wix/design-system/styles.global.css';
import '@wix/design-system/themes/odeditor.global.css';

const BUSINESS_MANAGER_DEFAULTS: WixDesignSystemDefaultProps = {
  Button: { size: 'small', skin: 'dark' },
  IconButton: { size: 'small', skin: 'dark', priority: 'tertiary' },
  TextButton: { size: 'small', skin: 'standard' },
  Input: { size: 'small' },
};

export const BusinessManagerTheme: FC<{ children: ReactNode; locale?: string }> = ({
  children,
  locale = i18n.getLocale(),
}) => (
  <WixDesignSystemProvider locale={locale}>
    <WixDesignSystemIconThemeProvider>
      <IconThemeProvider theme="odeditor">
        <WixDesignSystemDefaultPropsProvider defaults={BUSINESS_MANAGER_DEFAULTS}>
          {children}
        </WixDesignSystemDefaultPropsProvider>
      </IconThemeProvider>
    </WixDesignSystemIconThemeProvider>
  </WixDesignSystemProvider>
);
