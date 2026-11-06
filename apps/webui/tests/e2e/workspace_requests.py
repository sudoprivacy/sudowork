"""Observe fixture directory requests through the browser's actual CDP events."""

from urllib.parse import parse_qs, urlparse


async def trace_workspace_requests(context, page, source, evidence, origin):
    """Record this fixture's root reads without headers, cookies or bodies."""
    client = await context.new_cdp_session(page)
    requests = {}
    target = urlparse(origin)

    def started(event):
        request = event["request"]
        parsed = urlparse(request["url"])
        session = evidence.get("sessionId")
        query = parse_qs(parsed.query)
        if (not session or (parsed.scheme, parsed.netloc) != (target.scheme, target.netloc)
                or parsed.path != "/api/conversations/" + session + "/workspace/tree"
                or request["method"] != "GET" or query.get("path") or query.get("search")):
            return
        identifier = event["requestId"]
        if identifier in requests:
            return
        record = {"source": source, "requestId": identifier, "startedAt": event["timestamp"]}
        requests[identifier] = record
        evidence.setdefault("workspaceRequests", []).append(record)

    def received(event):
        record = requests.get(event["requestId"])
        if record is not None:
            response = event["response"]
            record.update(status=response["status"], protocol=response.get("protocol"),
                          sendStartMs=response.get("timing", {}).get("sendStart"))

    def completed(event):
        record = requests.get(event["requestId"])
        if record is not None:
            record["finishedAt"] = event["timestamp"]
            if "errorText" in event:
                record["failure"] = event["errorText"]

    client.on("Network.requestWillBeSent", started)
    client.on("Network.responseReceived", received)
    client.on("Network.loadingFinished", completed)
    client.on("Network.loadingFailed", completed)
    await client.send("Network.enable")
    return client


def workspace_request_summary(records):
    """Count overlapping intervals by page and across the shared browser clock."""
    events = []
    counts = {}
    for record in records:
        source = record["source"]
        counts[source] = counts.get(source, 0) + 1
        if record.get("finishedAt") == record["startedAt"]:
            continue
        assert "finishedAt" not in record or record["finishedAt"] > record["startedAt"], "Chrome returned a reversed request interval"
        events.append((record["startedAt"], 1, source))
        if "finishedAt" in record:
            events.append((record["finishedAt"], -1, source))
    pending = 0
    maximum = 0
    pending_by_page = {source: 0 for source in counts}
    maximum_by_page = dict(pending_by_page)
    for _, change, source in sorted(events):
        pending += change
        maximum = max(maximum, pending)
        pending_by_page[source] += change
        maximum_by_page[source] = max(maximum_by_page[source], pending_by_page[source])
    return {"requestsByPage": counts, "maxPending": maximum,
            "maxPendingByPage": maximum_by_page,
            "unfinished": sum("finishedAt" not in record for record in records)}
