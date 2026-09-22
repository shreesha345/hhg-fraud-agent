/**
 * CustomerExplanation: Displays a simple, jargon-free explanation suitable for customers
 * Shows what happened and what we're doing about it in plain language
 */
"use client";

interface Props {
  explanation?: string;
  verdict: "fraud" | "legitimate" | "uncertain";
  pattern: string;
}

export function CustomerExplanation({ explanation, verdict, pattern }: Props) {
  if (!explanation) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          {verdict === "fraud" ? (
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ) : verdict === "legitimate" ? (
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            Customer-Friendly Explanation
          </h3>
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {explanation}
          </div>
          {verdict === "fraud" && (
            <div className="mt-3 text-xs text-gray-600 bg-white rounded px-3 py-2 border border-gray-200">
              <strong>Next Steps:</strong> We'll review this activity and may contact you to verify these transactions.
            </div>
          )}
          {verdict === "uncertain" && (
            <div className="mt-3 text-xs text-gray-600 bg-white rounded px-3 py-2 border border-gray-200">
              <strong>Next Steps:</strong> We need more information to determine if this activity is genuine. You may receive a verification request.
            </div>
          )}
          {verdict === "legitimate" && (
            <div className="mt-3 text-xs text-gray-600 bg-white rounded px-3 py-2 border border-gray-200">
              <strong>Status:</strong> No further action needed. This activity appears normal.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
