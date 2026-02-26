export type CollectionViewType = 'table' | 'board' | 'calendar' | 'gallery' | 'list';

export interface Collection {
    id: string;
    workspace_id: string;
    name: string;
    description?: string;
    icon?: string;
    schema: {
        properties: Record<string, CollectionProperty>;
    };
    created_at: string;
    updated_at: string;
    created_by?: string;
}

export interface CollectionProperty {
    type: 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'checkbox' | 'url' | 'email' | 'phone';
    name: string;
    options?: { label: string; value: string; color?: string }[];
}

export interface CollectionView {
    id: string;
    collection_id: string;
    name: string;
    type: CollectionViewType;
    configuration: {
        filter?: any;
        sort?: any;
        group_by?: string;
        visible_columns?: string[];
        [key: string]: any;
    };
    position: number;
    created_at: string;
    updated_at: string;
}
