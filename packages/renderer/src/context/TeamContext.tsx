/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from 'react';
import type { TTeam } from '@renderer/pages/team/types';

/**
 * Team context — shares the currently-viewed team across the detail page tree
 * (mirrors ConversationContext). 附录 II.3.
 */
export interface TeamContextValue {
  team: TTeam;
  teamId: string;
}

const TeamContext = createContext<TeamContextValue | null>(null);

export const TeamProvider: React.FC<{
  children: React.ReactNode;
  value: TeamContextValue;
}> = ({ children, value }) => {
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
};

export const useTeamContext = (): TeamContextValue => {
  const context = useContext(TeamContext);
  if (!context) {
    throw new Error('useTeamContext must be used within TeamProvider');
  }
  return context;
};

export const useTeamContextSafe = (): TeamContextValue | null => {
  return useContext(TeamContext);
};
