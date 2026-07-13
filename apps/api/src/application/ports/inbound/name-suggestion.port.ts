export interface NameSuggestionPort {
  suggestSkillId(title: string, description?: string): Promise<{
    suggestion: string;
    alternatives: string[];
    isAvailable: boolean;
  }>;
}
