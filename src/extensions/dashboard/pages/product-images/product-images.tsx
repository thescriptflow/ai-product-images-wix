import React, { useEffect, useState } from 'react';
import { dashboard, type PageLocation, type PageParams } from '@wix/dashboard';
import { BusinessManagerTheme } from '../../BusinessManagerTheme';
import { ProductsApp } from './ProductsApp';

const Page = () => {
  const [location, setLocation] = useState<PageLocation | undefined>();

  useEffect(() => {
    const subscription = dashboard.observeState<PageParams>((pageParams) => {
      setLocation(pageParams.location);
    });
    return () => subscription.disconnect();
  }, []);

  return (
    <BusinessManagerTheme>
      {location ? <ProductsApp location={location} /> : null}
    </BusinessManagerTheme>
  );
};

export default Page;
