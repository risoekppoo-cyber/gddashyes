# Empty exception-pointer service profile

The worker's first C++ runtime dependency was __ExceptionPtrCreate. The supported
profile now covers Create, Destroy, Copy, Assign and ToBool for empty objects.
This does not capture, copy, throw, rethrow or unwind a non-empty exception.

## Evidence

Microsoft's [excptptr.cpp](https://github.com/microsoft/STL/blob/e1ed302683e5e822f663fbb0f44cee7e9ddc6af0/stl/src/excptptr.cpp#L416)
implements these entry points using shared_ptr<const EXCEPTION_RECORD>. The file
also checks that exception_ptr and that shared_ptr have matching size/alignment.
The [public exception header](https://github.com/microsoft/STL/blob/e1ed302683e5e822f663fbb0f44cee7e9ddc6af0/stl/inc/exception#L239)
routes construction, copying, assignment, destruction and boolean queries to
those entry points. The source is pinned; it is not a claim that every Windows
runtime binary has an identical internal implementation.

integration-tests/exception-ptr-native.py invokes the installed x64 msvcp140.dll
exports in a private Windows process. The recorded native result verifies:

- Create writes 16 zero bytes into previously patterned storage.
- Copying an empty object initializes the destination to the same 16 zero bytes.
- Empty assignment and self-assignment preserve zeros; ToBool returns false.
- Empty destruction leaves those bytes unchanged.
- The 16-byte guards on both sides of each object remain unchanged.

No fabricated exception record or non-empty control block is passed to the DLL.

## Implementation boundary

GuestExceptionPtr tracks live constructed storage separately from its contents.
Copies require an owned empty source; assignment requires two live empty objects.
Destroy ends the tracked lifetime. Duplicate construction, unaligned/out-of-range
storage, use after destruction and non-empty control blocks fail explicitly.
Freeing a containing owned heap allocation removes its interior tracked objects,
allowing safe address reuse. Process disposal clears remaining bookkeeping.

Direct inline moves into previously untracked storage are not implemented by
this bounded service profile. If observed, extend the profile with source and
native evidence; do not silently accept arbitrary exception records. Compare,
Swap, CurrentException, CopyException and Rethrow imports remain unresolved.

The JS service tests check the recorded bytes, guards, lifecycle/heap ownership,
guest return stack and rejection paths. The independent Unicorn fixture compares
live-object identities and memory writes during actual worker execution at both
DLL image bases. Full CRT thread startup and full Geode support remain false.
