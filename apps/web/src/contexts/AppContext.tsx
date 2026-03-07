import React, { createContext, useContext } from 'react';
import type { WorkspaceMembershipSummary, WorkspacePermissionSummary, WorkspaceRecord } from '../api/client';
import type { Collection } from '../types/collection';

export interface CollectionItem {
  id: string;
  properties: Record<string, any>;
  [key: string]: any;
}

export interface AppContextValue {
  user: any | null;
  workspace: WorkspaceRecord | null;
  workspacePermissions: WorkspacePermissionSummary;
  workspaceMembershipSummary: WorkspaceMembershipSummary | null;
  documents: any[];
  collections: Collection[];
  activeDoc: any | null;
  setActiveDoc: React.Dispatch<React.SetStateAction<any | null>>;
  handleSelectDoc: (doc: any) => void;
  handleNewDoc: (parentId?: string) => Promise<void>;
  activeCollection: Collection | null;
  setActiveCollection: React.Dispatch<React.SetStateAction<Collection | null>>;
  handleSelectCollection: (col: Collection) => void;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  presentationMode: boolean;
  setPresentationMode: React.Dispatch<React.SetStateAction<boolean>>;
  showTaskModal: boolean;
  editingItem: CollectionItem | null;
  openTaskModal: () => void;
  openEditModal: (item: CollectionItem) => void;
  closeTaskModal: () => void;
}

const DEFAULT_WORKSPACE_PERMISSIONS: WorkspacePermissionSummary = {
  canViewWorkspace: false,
  canManageMembers: false,
  canManageSettings: false,
  canEditDocuments: false,
  canDeleteDocuments: false,
  canRunAutomation: false,
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppContextProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: AppContextValue;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used inside <AppContextProvider>');
  }
  return ctx;
}

export function useOptionalAppContext(): AppContextValue | null {
  return useContext(AppContext);
}

export function useWorkspacePermissions(): WorkspacePermissionSummary {
  return useOptionalAppContext()?.workspacePermissions ?? DEFAULT_WORKSPACE_PERMISSIONS;
}
