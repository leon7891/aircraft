// @ts-strict-ignore
// Copyright (c) 2023-2024 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, Route, useHistory } from 'react-router-dom';

export interface PageLink {
  name: string;
  alias?: string;
  component: JSX.Element;
}

interface PageRouteProps {
  basePath: string;
  tabs: PageLink[];
}

export const pathify = (alias: string): string => alias.toLowerCase().replace(/[^a-z0-9]/gi, '-');

export const TabRoutes = ({ basePath, tabs }: PageRouteProps) => {
  const [routes] = useState(() =>
    tabs.map((tab) => (
      <Route key={tab.name} path={`${basePath}/${pathify(tab.name)}`} component={() => tab.component} />
    )),
  );

  return <>{routes}</>;
};

type HistoryEntry = { pathname: string; search: string; hash: string; state: any; key: string };

export const findLatestSeenPathname = (history: any, basePath: string): string | undefined => {
  // @ts-ignore
  const historyEntries: HistoryEntry[] = history.entries;
  return [...historyEntries].reverse().find(({ pathname }) => pathname.includes(`${basePath}/`))?.pathname;
};

interface PageRedirectProps extends PageRouteProps {
  /** Name of the tab opened when none was visited yet, the first tab by default */
  defaultTab?: string;
}

export const PageRedirect = ({ basePath, tabs, defaultTab = tabs[0].name }: PageRedirectProps) => {
  const history = useHistory();
  const getRedirectPathname = useCallback(
    () => findLatestSeenPathname(history, basePath) ?? `${basePath}/${pathify(defaultTab)}`,
    [history, basePath, defaultTab],
  );
  const redirectPathname = useRef(getRedirectPathname());

  useEffect(
    () =>
      history.listen(() => {
        redirectPathname.current = getRedirectPathname();
      }),
    [],
  );

  return (
    <Route exact path={basePath}>
      <Redirect to={redirectPathname.current} />
    </Route>
  );
};
