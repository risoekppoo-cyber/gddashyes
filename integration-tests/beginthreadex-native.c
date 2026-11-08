/* Actual UCRT lifecycle evidence for the loader's null/zero/flags=0 profile. */
#include <windows.h>
#include <process.h>
#include <errno.h>
#include <stdio.h>
static HANDLE gate,entered;
static unsigned child_id;
static int initial_errno,initial_tls,child_checks;
static __declspec(thread) int thread_value=123;
static unsigned __stdcall child(void *arg){
 initial_errno=errno;initial_tls=thread_value;child_id=GetCurrentThreadId();
 child_checks=(arg==(void*)&gate&&initial_errno==0&&initial_tls==123);
 errno=456;thread_value=888;SetLastError(789);
 child_checks=child_checks&&GetLastError()==789;
 SetEvent(entered);
 if(WaitForSingleObject(gate,5000)!=WAIT_OBJECT_0)return 99;
 child_checks=child_checks&&errno==456&&thread_value==888;
 return 0x1234abcd;
}
#define CHECK(x) do{if(!(x)){fprintf(stderr,"check failed at line %d\n",__LINE__);return 1;}}while(0)
int main(void){
 unsigned id=0;DWORD code=0;uintptr_t raw;HANDLE thread;
 gate=CreateEventW(NULL,TRUE,FALSE,NULL);entered=CreateEventW(NULL,TRUE,FALSE,NULL);CHECK(gate&&entered);
 errno=321;thread_value=777;
 raw=_beginthreadex(NULL,0,child,&gate,0,&id);CHECK(raw!=0);thread=(HANDLE)raw;
 CHECK(WaitForSingleObject(entered,5000)==WAIT_OBJECT_0);
 CHECK(id==child_id&&id!=GetCurrentThreadId());CHECK(errno==321&&thread_value==777);
 CHECK(WaitForSingleObject(thread,0)==WAIT_TIMEOUT);
 CHECK(GetExitCodeThread(thread,&code)&&code==STILL_ACTIVE);
 CHECK(SetEvent(gate));CHECK(WaitForSingleObject(thread,5000)==WAIT_OBJECT_0);
 CHECK(GetExitCodeThread(thread,&code)&&code==0x1234abcd&&child_checks);
 CHECK(CloseHandle(thread));SetLastError(0);
 CHECK(WaitForSingleObject(thread,0)==WAIT_FAILED&&GetLastError()==ERROR_INVALID_HANDLE);
 CHECK(CloseHandle(gate)&&CloseHandle(entered));
 printf("{\"status\":\"UCRT_THREAD_NATIVE_PASS\",\"securityNull\":true,\"stackSize\":0,\"flags\":0,\"idOutputMatchesCallback\":true,\"childInitialErrno\":%d,\"childInitialStaticTls\":%d,\"parentErrnoAndTlsPreserved\":true,\"pendingWait\":258,\"exitCode\":%lu,\"closedHandleError\":6,\"browserThreadImplemented\":false,\"geodeDllTlsCallbacksVerified\":false}\n",initial_errno,initial_tls,(unsigned long)code);
 return 0;
}
