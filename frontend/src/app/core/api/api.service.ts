import { HttpClient, HttpResponse } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";

import {
  AdditionalTools,
  ConversationResponse,
  ConversationStatus,
  CreateConversationResponse,
  EntriesResponse,
  LedgerResponse,
  ListConversationsResponse,
  MessageResponse,
  MessagesResponse,
  ReasoningSpeed,
  SideTalkMessagesResponse,
  SideTalkReplyResponse,
  UsageResponse,
} from "./dto";

const BASE = "/api";

@Injectable({ providedIn: "root" })
export class ApiService {
  private readonly http = inject(HttpClient);

  listConversations(userId: string): Observable<ListConversationsResponse> {
    return this.http.get<ListConversationsResponse>(`${BASE}/conversations`, {
      params: { userId },
    });
  }

  createConversation(input: {
    userId: string;
    problemStatement: string;
    title?: string;
    reasoningSpeed?: ReasoningSpeed;
    additionalTools?: AdditionalTools;
  }): Observable<CreateConversationResponse> {
    return this.http.post<CreateConversationResponse>(`${BASE}/conversations`, input);
  }

  forkConversation(
    id: string,
    input: { upToCreatedAt: string; title?: string; markSolved?: boolean },
  ): Observable<CreateConversationResponse> {
    return this.http.post<CreateConversationResponse>(
      `${BASE}/conversations/${id}/fork`,
      input,
    );
  }

  getConversation(id: string): Observable<ConversationResponse> {
    return this.http.get<ConversationResponse>(`${BASE}/conversations/${id}`);
  }

  patchConversation(
    id: string,
    patch: {
      title?: string;
      status?: ConversationStatus;
      reasoningSpeed?: ReasoningSpeed;
      additionalTools?: AdditionalTools;
    },
  ): Observable<ConversationResponse> {
    return this.http.patch<ConversationResponse>(`${BASE}/conversations/${id}`, patch);
  }

  pauseConversation(id: string): Observable<ConversationResponse> {
    return this.http.post<ConversationResponse>(
      `${BASE}/conversations/${id}/pause`,
      {},
    );
  }

  resumeConversation(id: string): Observable<ConversationResponse> {
    return this.http.post<ConversationResponse>(
      `${BASE}/conversations/${id}/resume`,
      {},
    );
  }

  /**
   * Ask the backend to (re)generate the read-only solution walkthrough via the
   * Proof Narrator. Progress and the resulting narrative arrive over SSE.
   */
  narrateConversation(id: string): Observable<ConversationResponse> {
    return this.http.post<ConversationResponse>(
      `${BASE}/conversations/${id}/narrate`,
      {},
    );
  }

  deleteConversation(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/conversations/${id}`);
  }

  /**
   * Download the shareable export bundle (zip with `report.md`, `report.tex`,
   * `ledger.json`, `artifacts/`, `code/`). The full response is returned so the
   * caller can read the server-suggested file name from `Content-Disposition`.
   */
  exportConversation(id: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${BASE}/conversations/${id}/export`, {
      observe: "response",
      responseType: "blob",
    });
  }

  listMessages(id: string): Observable<MessagesResponse> {
    return this.http.get<MessagesResponse>(`${BASE}/conversations/${id}/messages`);
  }

  postMessage(
    id: string,
    content: string,
    options?: { reasoningSpeed?: ReasoningSpeed; additionalTools?: AdditionalTools },
  ): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/conversations/${id}/messages`, {
      content,
      ...(options?.reasoningSpeed ? { reasoningSpeed: options.reasoningSpeed } : {}),
      ...(options?.additionalTools ? { additionalTools: options.additionalTools } : {}),
    });
  }

  listSideTalk(id: string): Observable<SideTalkMessagesResponse> {
    return this.http.get<SideTalkMessagesResponse>(
      `${BASE}/conversations/${id}/side-talk`,
    );
  }

  askSideTalk(
    id: string,
    content: string,
    webSearch = false,
  ): Observable<SideTalkReplyResponse> {
    return this.http.post<SideTalkReplyResponse>(
      `${BASE}/conversations/${id}/side-talk`,
      { content, webSearch },
    );
  }

  clearSideTalk(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/conversations/${id}/side-talk`);
  }

  deleteSideTalkMessage(id: string, messageId: string): Observable<void> {
    return this.http.delete<void>(
      `${BASE}/conversations/${id}/side-talk/${messageId}`,
    );
  }

  getLedger(id: string): Observable<LedgerResponse> {
    return this.http.get<LedgerResponse>(`${BASE}/conversations/${id}/ledger`);
  }

  getUsage(id: string): Observable<UsageResponse> {
    return this.http.get<UsageResponse>(`${BASE}/conversations/${id}/usage`);
  }

  listEntries(id: string, since?: string): Observable<EntriesResponse> {
    const params: Record<string, string> = {};
    if (since) params["since"] = since;
    return this.http.get<EntriesResponse>(`${BASE}/conversations/${id}/ledger/entries`, {
      params,
    });
  }
}
