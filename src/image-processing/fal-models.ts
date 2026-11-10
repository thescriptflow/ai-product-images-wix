/** Model ids for the live fal calls. Change them here, or override the scene model with FAL_SCENE_MODEL. */
export const FAL_MODELS = {
  removeBackground: 'fal-ai/bria/background/remove',
  /** Default AI scene model (about $0.04 per image). */
  aiScene: 'fal-ai/flux-pro/kontext',
  /** Cheaper AI scene model (about $0.025 per image). Set FAL_SCENE_MODEL to this id to use it. */
  aiSceneDev: 'fal-ai/flux-kontext/dev',
} as const;

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/i;

export function resolveSceneModel(env: NodeJS.ProcessEnv): string {
  const requested = env.FAL_SCENE_MODEL?.trim() ?? '';
  if (!requested) return FAL_MODELS.aiScene;
  if (!MODEL_ID.test(requested)) {
    console.error('FAL_SCENE_MODEL is not a fal model id. Using the Pro default.');
    return FAL_MODELS.aiScene;
  }
  return requested;
}
