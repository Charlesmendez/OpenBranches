export async function copyText(value: string): Promise<void> {
  if (window.openbranches) {
    await window.openbranches.copyText(value);
    return;
  }
  await navigator.clipboard.writeText(value);
}
