export function normalizeGeneratedThreadTitle(title: string): string {
  return title.trim();
}

export function buildNewThreadTitle(input: {
  draftText: string;
  firstImageName: string | null;
}): string {
  const trimmedDraftText = normalizeGeneratedThreadTitle(input.draftText);
  if (trimmedDraftText.length > 0) {
    return trimmedDraftText;
  }

  if (input.firstImageName) {
    return `Image: ${input.firstImageName}`;
  }

  return "New thread";
}
