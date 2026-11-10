export function buildScenePrompt(userPrompt: string | undefined, productName: string): string {
  const scene = userPrompt?.trim() || 'a clean lifestyle scene with soft natural light';
  const name = productName.replace(/["\n\r]/g, ' ').trim() || 'product';
  return (
    `This photo shows the product "${name}". Keep exactly this product, unchanged: same shape, colour, material, logos and text. ` +
    'If a person is wearing or holding it, keep the same person, pose and clothing. ' +
    `Change only the background and surroundings to: ${scene}. ` +
    'Do not replace, add or remove products. Photorealistic professional product photography with natural light and shadows.'
  );
}
