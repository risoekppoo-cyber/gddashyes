# Nonblocking batch IOCP profile — 8 November 2026

GetQueuedCompletionStatusEx consumes the actual owned completion-port FIFO, up
to 64 entries per call, for timeout zero and alertable false. Empty polls return
false with error 258 and write zero removed entries. They do not invent a packet.

## Native evidence

The [Microsoft API contract](https://learn.microsoft.com/en-us/windows/win32/api/ioapiset/nf-ioapiset-getqueuedcompletionstatusex)
and [entry structure](https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ns-minwinbase-overlapped_entry)
describe batch output and per-operation completion information. The
[actual Windows oracle](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42471603516)
checks guarded x64 output, posted packets, successful pipe reads and a failed
overlapped pipe read. The reproducible probe and recorded JSON are in
integration-tests/iocp-batch-native.py and iocp-batch-native-result.json.

The observed entry size is 32 bytes: completion key at 0, OVERLAPPED pointer at 8,
internal status at 16, byte count at 24 and trailing padding at 28. Returned
entries in this profile have zero trailing padding. Unused entries and outer
guards remain untouched. The reserved Internal field is reproduced from this
native evidence, rather than claimed as a universal public ABI guarantee.

Native empty polls set the removed count to zero. Invalid-handle and zero-count
calls preserve its previous value (the probe uses 123), with errors 6 and 87.
Successful batches preserve the prior last-error value in the tested profile.
FIFO ordering, partial batches and the remaining queue are verified.

A failed pipe operation still produces a successful dequeue. Its entry carries
the operation status (0xc000014b for the probed broken pipe); it does not turn the
entire batch into a failed API call.

## Implementation and checks

The underlying IOCP stores the operation status when completion occurs, so a
later OVERLAPPED reuse cannot change the queued status. Manually posted packets
carry success status and opaque pointers without dereferencing them.

The service validates buffers before consuming packets and preserves unreturned
entries. Counts above 64, overlapping outputs, blocking waits and alertable/APC
dispatch are explicit unsupported profiles. Malformed guest memory also stops;
Windows invalid-pointer exception behavior is not emulated.

Focused Node tests compare the native bytes/counts/errors and drive real guest
pipe reads, writes and close completion through the same FIFO. They also check
bounds, guards, rejection of unsupported waits and unchanged packets on rejection.
Independent native worker execution checks the batch history, memory and queue
state. Native fixture time is scripted; the actual browser retains its real
monotonic clock. Full thread startup and mod loading remain unfinished.

## Current worker checkpoint

The actual browser and native fixture perform the 64-entry, zero-timeout,
non-alertable poll on an empty owned port. It returns false/error 258 and zero
entries. They pause at the instruction after that call (RVA 0x4f165b), with the
worker marked runnable and its context retained. This deliberate frontier
requires scheduler continuation; it is not an unsupported Windows import.
Full callback-loop behavior beyond this frontier remains unverified.

Validation: [native reference and actual browser run](https://github.com/risoekppoo-cyber/gddashyes/actions/runs/42472850120).
The probe/units cover nonempty batches and actual pipe data/status separately;
the browser run does not claim it delivered a completion packet to this worker.
