import type { EasyInputMessage, ResponseInput } from "openai/resources/responses/responses";
import { queryDocuments } from "~/server/utils/documentService";
import { forbidsWebSearch, wantsDocumentContext } from "~/server/utils/documentIntent";
import { generateChatResponse } from "~/server/utils/chatResponse";
import { logger } from "~/server/utils/logger";
import { prisma } from "~/server/db.server";
import {
  getConversation,
  createNewConversation,
  ensureConversation,
} from "~/server/utils/apiCalls/getConversation";
import { updateConversationTitle } from "~/server/utils/apiCalls/updateConversationTitle";

export async function createChatCompletion(
  message: string,
  conversationId: string | undefined,
  userId: string
): Promise<{ response: string; words: string[]; conversationId: string }> {
  try {
    // Pull document context when the message refers to documents. Retrieval is
    // scoped to the current conversation's uploads first, then the user's most
    // recent upload, then a corpus-wide semantic search (see queryDocuments).
    let documentContext = "";
    if (wantsDocumentContext(message)) {
      try {
        documentContext = await queryDocuments(message, userId, conversationId);
      } catch (docError) {
        logger.logError(docError);
        // Continue without document context
      }
    }

    let conversation = conversationId ? await getConversation(conversationId, userId) : null;

    const messages: ResponseInput = conversation
      ? conversation.messages.map((msg): EasyInputMessage => msg.role === "user"
          ? { role: "user", content: msg.content }
          // Stored assistant messages contain only completed answers. Legacy
          // messages have no phase column and are replayed as completed answers.
          : { role: "assistant", phase: "final_answer", content: msg.content })
      : [];

    // Keep retrieved text at user authority rather than promoting it to system
    // instructions. Only the application's instructions belong at that level.
    if (documentContext) {
      messages.push({
        role: "user",
        content: `Retrieved document passages (reference material):\n${documentContext}`,
      });
    }
    messages.push({ role: "user", content: message });

    const fullResponse = await generateChatResponse(messages, !forbidsWebSearch(message));

    // Only create the conversation after a successful AI response. When the client
    // supplied an id (an upload may already have created the row under it), reuse it
    // via ensureConversation; otherwise fall back to a server-generated conversation.
    if (!conversation) {
      conversation = conversationId
        ? await ensureConversation(conversationId, userId)
        : await createNewConversation(userId);
    }

    // Save the messages
    try {
      await prisma.message.createMany({
        data: [
          {
            content: message,
            role: "user",
            conversationId: conversation.id,
          },
          {
            content: fullResponse,
            role: "assistant",
            conversationId: conversation.id,
          },
        ],
      });
    } catch (dbError) {
      logger.logError(dbError);
      throw new Error("Failed to save conversation to database");
    }

    // Update conversation title if this is the first message
    if (conversation.messages.length === 0) {
      try {
        await updateConversationTitle(conversation.id, userId);
      } catch (titleError) {
        logger.logError(titleError);
        // Don't throw here, as the main conversation was saved
      }
    }

    const words = fullResponse.split(" ");

    return {
      response: fullResponse,
      words,
      conversationId: conversation.id,
    };
  } catch (error) {
    logger.logError(error);
    throw error; // Re-throw the original error instead of wrapping it
  }
}
