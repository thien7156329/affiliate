import { useState, useEffect } from 'react';

export interface ActiveAiModelInfo {
  id: string;
  name: string;
  label: string;
  role: string;
}

export interface ActiveAiModelsState {
  ai1: ActiveAiModelInfo;
  ai2: ActiveAiModelInfo;
  validator: ActiveAiModelInfo;
}

export const DEFAULT_AI_MODELS: ActiveAiModelsState = {
  ai1: {
    id: 'claude-opus-5-5-medium',
    name: 'AI 1 (Claude Opus 5.5 Med)',
    label: 'Claude Opus 5.5 Med',
    role: 'Sáng tác kịch bản 3D',
  },
  ai2: {
    id: 'gemini-4-argon-low',
    name: 'AI 2 (Gemini 4 Argon Low)',
    label: 'Gemini 4 Argon Low',
    role: 'Kiểm định tiêu chí & bố cục',
  },
  validator: {
    id: 'gemini-4-argon-low',
    name: 'Hệ Thống Kiểm Định (Gemini 4 Argon Low)',
    label: 'Gemini 4 Argon Low',
    role: 'Kiểm định an toàn Veo 3',
  },
};

let cachedAiModels: ActiveAiModelsState | null = null;
const listeners = new Set<(models: ActiveAiModelsState) => void>();

export async function fetchActiveAiModels(force: boolean = false): Promise<ActiveAiModelsState> {
  if (cachedAiModels && !force) return cachedAiModels;
  try {
    const res = await fetch('/api/pipeline/ai-models');
    const data = await res.json();
    if (data.success && data.ai1 && data.ai2) {
      cachedAiModels = {
        ai1: data.ai1,
        ai2: data.ai2,
        validator: data.validator || DEFAULT_AI_MODELS.validator,
      };
      listeners.forEach((fn) => fn(cachedAiModels!));
      return cachedAiModels;
    }
  } catch (err) {
    console.warn('Failed to fetch active AI models, using default:', err);
  }
  return cachedAiModels || DEFAULT_AI_MODELS;
}

export function updateCachedAiModels(updater: (prev: ActiveAiModelsState) => ActiveAiModelsState): ActiveAiModelsState {
  const current = cachedAiModels || DEFAULT_AI_MODELS;
  cachedAiModels = updater(current);
  listeners.forEach((fn) => fn(cachedAiModels!));
  return cachedAiModels;
}

export function useActiveAiModels(): ActiveAiModelsState {
  const [models, setModels] = useState<ActiveAiModelsState>(cachedAiModels || DEFAULT_AI_MODELS);

  useEffect(() => {
    fetchActiveAiModels().then(setModels);
    listeners.add(setModels);
    return () => {
      listeners.delete(setModels);
    };
  }, []);

  return models;
}

