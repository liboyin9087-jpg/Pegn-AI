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
    type:
        | 'text' | 'number' | 'select' | 'multi_select' | 'date'
        | 'checkbox' | 'url' | 'email' | 'phone'
        | 'formula'   // computed from other props
        | 'relation'  // links to items in another collection
        | 'rollup';   // aggregate from related collection
    name: string;
    options?: { label: string; value: string; color?: string }[];
    /** formula type: JS-like expression, use prop("Name") to reference fields */
    formula?: string;
    /** relation type: which collection to link to */
    relation?: {
        targetCollectionId: string;
        targetCollectionName?: string;
    };
    /** rollup type: aggregate a field across related items */
    rollup?: {
        relationPropId: string;   // ID of a relation property on this collection
        targetPropId: string;     // ID of the property on the related collection
        aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max';
    };
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
