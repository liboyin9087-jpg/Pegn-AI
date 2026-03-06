/**
 * AppContext  全局應用狀態
 *
 * 提供 workspace、documents、collections、activeDoc/activeCollection
 * 以及 TaskModal / presentationMode 開關，讓子組件免除深層 prop drilling。
 *
 * 使用方式：
 *   const { workspace, openTaskModal } = useAppContext();
 */

import React, { createContext, useContext } from 'react';
import type { Collection } from '../types/collection';

//  CollectionItem 

export interface CollectionItem {
  id: string;
  properties: Record<string, any>;
  [key: string]: any;
}

//  Context 型別 

export interface AppContextValue {
  // 認證 / Workspace
  user: any | null;
  workspace: any | null;

  // 文件
  documents: any[];
  activeDoc: any | null;
  setActiveDoc: React.Dispatch<React.SetStateAction<any | null>>;
  handleSelectDoc: (doc: any) => void;
  handleNewDoc: (parentId?: string) => Promise<void>;

  // Collection（資料庫）
  collections: Collection[];
  activeCollection: Collection | null;
  setActiveCollection: React.Dispatch<React.SetStateAction<Collection | null>>;
  handleSelectCollection: (col: Collection) => void;

  // UI 開關
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  presentationMode: boolean;
  setPresentationMode: React.Dispatch<React.SetStateAction<boolean>>;

  // TaskModal
  showTaskModal: boolean;
  editingItem: CollectionItem | null;
  openTaskModal: () => void;
  openEditModal: (item: CollectionItem) => void;
  closeTaskModal: () => void;
}

//  Context 

const AppContext = createContext<AppContextValue | null>(null);

//  Provider 

export function AppContextProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: AppContextValue;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

//  Hook 

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used inside <AppContextProvider>');
  }
  return ctx;
}