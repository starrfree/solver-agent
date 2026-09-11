import { Router } from "express";

import { eventBus, SolverEvent } from "../events/eventBus";
import { conversationRepo } from "../repositories/conversationRepo";
import { asyncHandler, pathParam } from "../util/asyncHandler";

const router = Router({ mergeParams: true });
const HEARTBEAT_INTERVAL_MS = 15_000;

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const conversation = await conversationRepo.requireById(pathParam(req, "id"));

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send("ready", {
      type: "ready",
      conversationId: conversation._id,
      ledgerId: conversation.ledgerId,
      activeAgents: eventBus.activeAgents(conversation._id),
    });

    const onEvent = (event: SolverEvent) => {
      send(event.type, event);
    };
    const unsubscribe = eventBus.subscribe(conversation._id, onEvent);

    const heartbeat = setInterval(() => {
      send("heartbeat", { ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };
    req.on("close", cleanup);
    req.on("aborted", cleanup);
  }),
);

export default router;
