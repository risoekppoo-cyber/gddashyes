# Guest performance-clock profile

QueryPerformanceFrequency and QueryPerformanceCounter share one clock domain
across all logical guest threads. The virtual frequency is fixed at 10,000,000
ticks/second. Counter readings come from performance.now(), converted from
milliseconds into integer ticks. Tick units do not promise matching browser
resolution: tied readings are allowed. This is elapsed time, not wall-clock time
or CPU cycles, and it does not use Date.now().

Microsoft documents the [frequency](https://learn.microsoft.com/en-us/windows/win32/api/profileapi/nf-profileapi-queryperformancefrequency)
in counts per second and the [counter](https://learn.microsoft.com/en-us/windows/win32/api/profileapi/nf-profileapi-queryperformancecounter)
as a 64-bit value suitable for interval measurements. The installed Windows
runtime was probed independently by integration-tests/performance-clock-native.py.
Its recorded result checks stable positive frequency, successful 8-byte output,
unchanged surrounding guards, nondecreasing samples and elapsed-time conversion.
The observed native frequency was 10 MHz; that is not a claim about every system.

The browser implementation separates whole milliseconds from fractional ticks
before BigInt conversion. It rejects non-finite, negative, backward or overflowing
samples rather than fabricating advancement. Output and return-stack bounds are
checked before sampling. Bad guest pointers fail explicitly; no Windows invalid
pointer return/error behavior is claimed.

Focused tests cover fixed frequency, conversion units, tied readings, guarded
outputs, a shared domain after thread selection, explicit failures and the actual
host monotonic clock. Native-reference execution uses a separately specified
deterministic clock (10 MHz, initial count 1,000,000,000, increment 10,000 per
counter call). Both native fixture and JS receive those inputs; the real browser
uses performance.now(), not the scripted fixture clock.

These queries do not implement sleep, timers, scheduling, timeouts or thread
lifecycle. Unsupported subsequent Windows services remain explicit boundaries.

## Arithmetic reached by timing conversion

The observed conversion code also needs unsigned register DIV instructions with
32- and 64-bit divisors. Their full 64-/128-bit dividends are assembled through
guarded logical shifts. Quotient overflow and zero divisors are checked before
modifying guest state. Valid quotients/remainders are compared with independent
x64 execution at two image bases; 1,032 additional executions of the generated
WASM are checked against BigInt arithmetic and complete CPU snapshots on faults.
This does not enable signed division, memory-operand division or guest exception
dispatch. Native undefined flags after successful DIV are not treated as defined.

The deterministic native fixture requires exact instruction counts. Real clock
values may change branch lengths in the browser, so clock-dependent worker paths
must reach the same boundary through the translated closure within the bounded
instruction budget. Unknown instruction paths still stop explicitly. The browser
report records its actual count and clock samples; the clock is never frozen to
force agreement with a scripted trace.
