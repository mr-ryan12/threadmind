// Intent detection for document retrieval routing.
// These helpers decide (1) whether a message should pull document context at all,
// (2) whether the user is pointing at a specific / just-uploaded document, and
// (3) whether they want the whole document rather than a semantic slice.

const DOCUMENT_KEYWORDS = [
  "document",
  "doc",
  "file",
  "pdf",
  "resume",
  "cv",
  "upload",
  "attachment",
  "text",
  "content",
];

const SPECIFIC_DOCUMENT_PATTERNS: RegExp[] = [
  /\b(just|recently) uploaded\b/,
  /\bi (just |recently )?uploaded\b/,
  /\bthis (document|doc|file|pdf|resume|cv|upload)\b/,
  /\bthat (document|doc|file|pdf|resume|cv|upload)\b/,
  /\bthe (document|doc|file|pdf|resume|cv) i\b/,
  /\bthe (upload|attachment)\b/,
  /\bmy (recent|latest|last) (upload|document|doc|file|resume|cv)\b/,
  /\b(most )?recent(ly)? (uploaded )?(document|doc|file|upload)\b/,
  /\blatest (document|doc|file|upload)\b/,
  /\bthe file i\b/,
];

const FULL_DOCUMENT_PATTERNS: RegExp[] = [
  /\bsummar(y|ize|ise|isation|ization)\b/,
  /\boverview\b/,
  /\btl;?dr\b/,
  // "what's in this", "what is in the document" — but not "what's <X> in the doc".
  /\bwhat('?s| is) in\b/,
  // "what is this about", "what does it say", "what's the document about".
  /\bwhat('?s| is| does| are) (this|it|that|the)\b.*\b(about|say|contain)\b/,
  /\bwhole (document|doc|file)\b/,
  /\bentire (document|doc|file)\b/,
  /\b(key|main) (points|takeaways|ideas)\b/,
  /\bgist\b/,
];

// Broadened replacement for the old three-keyword gate: any document reference,
// including phrases like "the one I just uploaded", should route to retrieval.
export function wantsDocumentContext(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    DOCUMENT_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
    referencesSpecificDocument(message)
  );
}

// True when the user is pointing at a particular / recently uploaded document
// rather than asking a general question that happens to mention documents.
export function referencesSpecificDocument(message: string): boolean {
  const normalized = message.toLowerCase();
  return SPECIFIC_DOCUMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

// True when the user wants the document as a whole (summary/overview) rather than
// a targeted lookup — this should return chunks in reading order, not by similarity.
export function wantsFullDocument(message: string): boolean {
  const normalized = message.toLowerCase();
  return FULL_DOCUMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

// Mentioning uploads doesn't exclude external sources. Remove the search tool
// only for an explicit source restriction or browsing prohibition.
export function forbidsWebSearch(message: string): boolean {
  const normalized = message.toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");
  const noWebPatterns = [
    /\b(?:do not|don't|never) (?:search|browse|use|consult|access) (?:the )?(?:web|internet|online sources?)\b/,
    /\b(?:no|without) (?:web|internet|online) (?:search(?:es)?|browsing|sources?)\b/,
  ];
  if (noWebPatterns.some((pattern) => pattern.test(normalized))) return true;

  // "Not only my documents" requests additional sources. It is not a
  // document-only restriction, but any separate no-web instruction above wins.
  const sourceRestriction = normalized.replace(
    /\b(?:not|don't|do not|never) (?:use )?(?:only|exclusively|solely)\b/g,
    "",
  );
  return [
    /\b(?:only|exclusively|solely) (?:(?:use|using|from|on) )?(?:(?:my|the|these|uploaded|provided) )*(?:docs?|documents?|uploads?|files?|attachments?)\b/,
    /\b(?:docs?|documents?|uploads?|files?|attachments?)[- ](?:only|exclusively)\b/,
  ].some((pattern) => pattern.test(sourceRestriction));
}
