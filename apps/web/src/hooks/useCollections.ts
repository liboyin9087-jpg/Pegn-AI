import { useState, useEffect, useCallback } from 'react';
import * as api from '../api/client';
import { Collection, CollectionView } from '../types/collection';

export function useCollections(workspaceId: string | undefined) {
    const [collections, setCollections] = useState<Collection[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const fetchCollections = useCallback(async () => {
        if (!workspaceId) return;
        setLoading(true);
        try {
            const data = await api.listCollections(workspaceId);
            setCollections(data.collections);
            setError(null);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => {
        fetchCollections();
    }, [fetchCollections]);

    const addCollection = async (name: string, description?: string) => {
        if (!workspaceId) return;
        try {
            const newCol = await api.createCollection({ workspaceId, name, description });
            setCollections(prev => [newCol, ...prev]);
            return newCol;
        } catch (err) {
            setError(err as Error);
            throw err;
        }
    };

    const removeCollection = async (id: string) => {
        try {
            await api.deleteCollection(id);
            setCollections(prev => prev.filter(c => c.id !== id));
        } catch (err) {
            setError(err as Error);
            throw err;
        }
    };

    return {
        collections,
        loading,
        error,
        fetchCollections,
        addCollection,
        removeCollection
    };
}

export function useCollectionViews(collectionId: string | undefined) {
    const [views, setViews] = useState<CollectionView[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const fetchViews = useCallback(async () => {
        if (!collectionId) return;
        setLoading(true);
        try {
            const data = await api.listCollectionViews(collectionId);
            setViews(data.views);
            setError(null);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, [collectionId]);

    useEffect(() => {
        fetchViews();
    }, [fetchViews]);

    const addView = async (name: string, type: string, configuration = {}) => {
        if (!collectionId) return;
        try {
            const newView = await api.createCollectionView({ collectionId, name, type, configuration });
            setViews(prev => [...prev, newView].sort((a, b) => a.position - b.position));
            return newView;
        } catch (err) {
            setError(err as Error);
            throw err;
        }
    };

    const removeView = async (id: string) => {
        try {
            await api.deleteCollectionView(id);
            setViews(prev => prev.filter(v => v.id !== id));
        } catch (err) {
            setError(err as Error);
            throw err;
        }
    };

    return {
        views,
        loading,
        error,
        fetchViews,
        addView,
        removeView
    };
}
export function useCollectionDocuments(collectionId: string | undefined) {
    const [documents, setDocuments] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const fetchDocuments = useCallback(async () => {
        if (!collectionId) return;
        setLoading(true);
        try {
            const data = await api.listCollectionDocuments(collectionId);
            setDocuments(data.documents);
            setError(null);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, [collectionId]);

    useEffect(() => {
        fetchDocuments();
    }, [fetchDocuments]);

    const addDocument = async (workspaceId: string, title: string) => {
        if (!collectionId) return;
        try {
            const res = await api.api<any>('/documents', {
                method: 'POST',
                body: JSON.stringify({ workspace_id: workspaceId, collection_id: collectionId, title })
            });
            setDocuments(prev => [res, ...prev]);
            return res;
        } catch (err) {
            setError(err as Error);
            throw err;
        }
    };

    const editDocument = async (id: string, updates: any) => {
        try {
            const res = await api.updateDocument(id, updates);
            setDocuments(prev => prev.map(d => d.id === id ? res : d));
            return res;
        } catch (err) {
            setError(err as Error);
            throw err;
        }
    };

    return {
        documents,
        loading,
        error,
        fetchDocuments,
        addDocument,
        editDocument
    };
}
