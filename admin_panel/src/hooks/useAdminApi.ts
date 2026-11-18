import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi } from "../lib/api";
import type {
  GroundingMode,
  KnowledgeDocument,
  KnowledgeDocumentScope,
  PersonaKnowledgeSettings,
  RuntimeProviderConfig,
} from "../types/api";

const queryKeys = {
  dashboard: ["admin", "dashboard"] as const,
  providers: ["admin", "providers"] as const,
  voices: ["admin", "voices"] as const,
  documents: ["admin", "documents"] as const,
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
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: adminApi.getProviderSettings,
  });
}

/** Saves a provider selection and refreshes dashboard health. */
export function useUpdateProviderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: RuntimeProviderConfig) =>
      adminApi.updateProviderSettings(payload),
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

/** Loads the document status list for the Grand Meridian tenant with adaptive in-flight polling. */
export function useKnowledgeDocuments() {
  return useQuery({
    queryKey: queryKeys.documents,
    queryFn: adminApi.getKnowledgeDocuments,
    refetchInterval: (query) => {
      const hasInFlight = query.state.data?.some(
        (doc) =>
          doc.ingestion_status === "pending" ||
          doc.ingestion_status === "indexing" ||
          doc.ingestion_status === "deleting",
      );
      return hasInFlight ? 2500 : false;
    },
  });
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
    }) =>
      adminApi.updateDocumentAssignments(documentId, {
        scope,
        assigned_personas,
      }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.documents });
      const previous = queryClient.getQueryData<KnowledgeDocument[]>(
        queryKeys.documents,
      );
      queryClient.setQueryData<KnowledgeDocument[] | undefined>(
        queryKeys.documents,
        (documents) =>
          documents?.map((document) =>
            document.id === variables.documentId
              ? {
                  ...document,
                  scope: variables.scope,
                  assigned_personas: variables.assigned_personas,
                }
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
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    },
  });
}

export function useToggleDocumentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      is_enabled,
    }: {
      documentId: string;
      is_enabled: boolean;
    }) => adminApi.toggleDocumentStatus(documentId, { is_enabled }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.documents });
      const previous = queryClient.getQueryData<KnowledgeDocument[]>(
        queryKeys.documents,
      );
      queryClient.setQueryData<KnowledgeDocument[] | undefined>(
        queryKeys.documents,
        (documents) =>
          documents?.map((document) =>
            document.id === variables.documentId
              ? { ...document, is_enabled: variables.is_enabled }
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
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    },
  });
}

export function useDeleteKnowledgeDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      adminApi.deleteKnowledgeDocument(documentId),
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
  return useMutation({
    mutationFn: ({
      query,
      persona_key,
    }: {
      query: string;
      persona_key?: string;
    }) => adminApi.searchKnowledge(query, persona_key),
  });
}

export function usePersonaKnowledgeSettings(personaKey: string) {
  return useQuery({
    queryKey: ["admin", "persona-settings", personaKey] as const,
    queryFn: () => adminApi.getPersonaKnowledgeSettings(personaKey),
    enabled: !!personaKey,
  });
}

export function useUpdatePersonaKnowledgeSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      personaKey,
      payload,
    }: {
      personaKey: string;
      payload: {
        grounding_mode: GroundingMode;
        min_relevance_score: number;
        max_chunks_per_turn: number;
        custom_fallback_spoken?: string | null;
      };
    }) => adminApi.updatePersonaKnowledgeSettings(personaKey, payload),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "persona-settings", variables.personaKey],
      });
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: ["admin", "persona-settings", variables.personaKey],
      });
      const previous = queryClient.getQueryData<PersonaKnowledgeSettings>([
        "admin",
        "persona-settings",
        variables.personaKey,
      ]);
      if (previous) {
        queryClient.setQueryData<PersonaKnowledgeSettings>(
          ["admin", "persona-settings", variables.personaKey],
          {
            ...previous,
            grounding_mode: variables.payload.grounding_mode,
            min_relevance_score: variables.payload.min_relevance_score,
            max_chunks_per_turn: variables.payload.max_chunks_per_turn,
            custom_fallback_spoken:
              variables.payload.custom_fallback_spoken ??
              previous.custom_fallback_spoken,
          },
        );
      }
      return { previous };
    },
    onError: (_error, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["admin", "persona-settings", variables.personaKey],
          context.previous,
        );
      }
    },
  });
}

/** Retrieves stored vector chunks for deep chunk inspection. */
export function useDocumentChunks(documentId: string | null) {
  return useQuery({
    queryKey: ['admin', 'knowledge', 'documents', documentId, 'chunks'],
    queryFn: () => adminApi.getDocumentChunks(documentId!),
    enabled: Boolean(documentId),
    staleTime: 60_000,
  });
}

/** Synthesizes an audio preview for the selected Voice Studio profile. */
export function useVoiceAudition() {
  return useMutation({ mutationFn: adminApi.auditionVoice });
}

export interface PersonaOption {
  key: string;
  name: string;
}

export const CANONICAL_PERSONAS: readonly PersonaOption[] = [
  { key: "hotel_booking_specialist", name: "Elena" },
  { key: "restaurant_dining", name: "Marco" },
  { key: "travel_desk", name: "Priya" },
  { key: "customer_care", name: "Jordan" },
] as const;

/** Canonical hook exposing tenant voice personas across knowledge and matrix components. */
export function useAvailablePersonas(): readonly PersonaOption[] {
  return CANONICAL_PERSONAS;
}
