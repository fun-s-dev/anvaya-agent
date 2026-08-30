export const providerAdapters = ['razorpay', 'mock-provider'] as const;

export function supportsProvider(provider: string): boolean {
  return providerAdapters.includes(provider as (typeof providerAdapters)[number]);
}
