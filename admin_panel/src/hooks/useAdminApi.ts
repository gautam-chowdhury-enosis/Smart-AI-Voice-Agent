import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminApi } from '../lib/api';
import type { KnowledgeDocument, KnowledgeDocumentScope, RuntimeProviderConfig } from '../types/api';

const queryKeys = {
  dashboard: ['admin', 'dashboard'] as const,
  providers: ['admin', 'providers'] as const,
  voices: ['admin', 'voices'] as const,
  documents: ['admin', 'documents'] as const,
};

/** Loads a live operational snapshot while the dashboard is open. */
export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: adminApi.getDashboard,
    refetchInterval: 5_000,
  });
}

/** Loads provider availability and the active runtime model. */
export function useProviderSettings() {
  return useQuery({ queryKey: queryKeys.providers, queryFn: adminApi.getProviderSettings });
}

/** Saves a provider selection and refreshes dashboard health. */
export function useUpdateProviderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: RuntimeProviderConfig) => adminApi.updateProviderSettings(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    },
  });
}

/** Loads the server-side voice catalog. */
export function useVoices() {
  return useQuery({ queryKey: queryKeys.voices, queryFn: adminApi.getVoices });
}

/** Loads the document status list for the Grand Meridian tenant. */
export function useKnowledgeDocuments() {
  return useQuery({ queryKey: queryKeys.documents, queryFn: adminApi.getKnowledgeDocuments });
}

/** Uploads a document and refreshes related operational counts. */
export function useUploadKnowledgeDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: adminApi.uploadKnowledgeDocument,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    },
  });
}

export function useUpdateDocumentAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      scope,
      assigned_personas,
    }: {
      documentId: string;
      scope: KnowledgeDocumentScope;
      assigned_personas: string[];
    }) => adminApi.updateDocumentAssignments(documentId, { scope, assigned_personas }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.documents });
      const previous = queryClient.getQueryData<KnowledgeDocument[]>(queryKeys.documents);
      queryClient.setQueryData<KnowledgeDocument[] | undefined>(queryKeys.documents, (documents) =>
        documents?.map((document) =>
          document.id === variables.documentId
            ? { ...document, scope: variables.scope, assigned_personas: variables.assigned_personas }
            : document,
        ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.documents, context.previous);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    },
  });
}

export function useToggleDocumentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, is_enabled }: { documentId: string; is_enabled: boolean }) =>
      adminApi.toggleDocumentStatus(documentId, { is_enabled }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.documents });
      const previous = queryClient.getQueryData<KnowledgeDocument[]>(queryKeys.documents);
      queryClient.setQueryData<KnowledgeDocument[] | undefined>(queryKeys.documents, (documents) =>
        documents?.map((document) =>
          document.id === variables.documentId ? { ...document, is_enabled: variables.is_enabled } : document,
        ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.documents, context.previous);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    },
  });
}

export function useDeleteKnowledgeDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => adminApi.deleteKnowledgeDocument(documentId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    },
  });
}

/** Executes an explicit knowledge search test when an operator submits it. */
export function useKnowledgeSearch() {
  return useMutation({ mutationFn: adminApi.searchKnowledge });
}

/** Synthesizes an audio preview for the selected Voice Studio profile. */
export function useVoiceAudition() {
  return useMutation({ mutationFn: adminApi.auditionVoice });
}
