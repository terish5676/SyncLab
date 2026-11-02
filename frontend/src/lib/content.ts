export interface Concept { id: string; title: string; body: string[] }

export const CONCEPTS: Concept[] = [
  { id: 'threads', title: 'Processes and threads', body: [
    'A process is a running program with its own memory. A thread is a unit of execution inside a process, and all threads of a process share its memory.',
    'SyncLab starts one real operating-system thread per reader and per writer. They all touch the same shared register, which is exactly why synchronization is needed.' ] },
  { id: 'concurrency', title: 'Concurrency and parallelism', body: [
    'Concurrency means several tasks are in progress at once, with their steps interleaved. Parallelism means several tasks execute at the same instant on different cores.',
    'Python threads are concurrent. Blocking calls such as semaphore waits release the interpreter lock, so waiting threads really do sleep in the operating system while others run.' ] },
  { id: 'critical', title: 'Critical sections', body: [
    'A critical section is code that touches shared data and must not be interleaved with conflicting code. Here the critical section is "read the register" or "modify the register".',
    'Reading is safe to share. Writing is not. That asymmetry is the whole reader–writer problem.' ] },
  { id: 'race', title: 'Race conditions', body: [
    'A race condition is a bug where the result depends on the unlucky timing of threads. Two writers that each read 100, add 10 and store 110 leave 110 instead of 120. One update is lost.',
    'SyncLab checks for this directly. After a run it recomputes the value the committed writes should have produced and compares it with the register.' ] },
  { id: 'mutex', title: 'Mutual exclusion', body: [
    'Mutual exclusion guarantees that at most one thread is inside a critical section at a time. A binary semaphore (a mutex) provides it.',
    'Readers relax the rule among themselves. Mutual exclusion applies between a writer and everyone else.' ] },
  { id: 'semaphores', title: 'Binary and counting semaphores', body: [
    'A semaphore is a counter with two atomic operations. wait(s) blocks until s is positive, then decrements it. signal(s) increments it and wakes a waiter.',
    'A binary semaphore starts at 1 and acts as a lock. A counting semaphore starts at n and admits up to n holders. All three algorithms here use binary semaphores.' ] },
  { id: 'problem', title: 'The reader–writer problem', body: [
    'Many threads share one resource. Readers only look, so any number may read together. A writer changes it, so it needs the resource alone. No reader may see a half-written value.',
    'The rules are easy. The difficulty is deciding who goes next when both kinds are waiting. Each answer is a different algorithm with different trade-offs.' ] },
  { id: 'starvation', title: 'Starvation', body: [
    'A thread starves when it is repeatedly passed over and never makes progress, even though the system keeps working for others.',
    'A finite run cannot prove starvation. SyncLab raises a warning when one side waits far longer than the other side&apos;s average. Treat it as a pointer, then look at the swim lanes.' ] },
  { id: 'deadlock', title: 'Deadlock and its prevention', body: [
    'Deadlock is a cycle where every thread waits for something another waiting thread holds, so none can move. It needs four conditions: mutual exclusion, hold and wait, no preemption, and circular wait.',
    'Each algorithm here acquires its semaphores in one fixed order, and every wait can be cancelled. Stop wakes blocked threads and releases whatever they hold, so a run can always be cleaned up.' ] },
  { id: 'invariants', title: 'Correctness invariants', body: [
    'An invariant is a statement that must be true at every moment. The five SyncLab checks are: readers and writers never overlap, at most one writer is inside, counters never go negative, each committed write raises the version by exactly one, and no update is lost.',
    'The backend enforces the first two inside the resource itself and raises an error on a breach. The browser audits the event log a second time, independently.' ] },
  { id: 'metrics', title: 'Performance metrics', body: [
    'Waiting time is the gap between asking for access and being admitted. Throughput is completed operations per second. Occupancy is the share of the run during which anyone held the resource. It is not CPU usage.',
    'Pauses are excluded from elapsed time so a paused run does not look slow.' ] },
];

export interface AlgoSheet {
  id: string; title: string; preset: string; idea: string; semaphores: string[]; code: string;
  steps: string[]; example: string; pros: string[]; cons: string[]; starvation: string; invariants: string[];
}

export const ALGOS: AlgoSheet[] = [
  {
    id: 'reader-pref', title: 'Reader preference', preset: 'starve',
    idea: 'Readers join whenever other readers are already inside. Writers wait for the reader group to empty.',
    semaphores: ['mutex = 1 protects read_count', 'resource = 1 is held by the reader group or by one writer', 'read_count = 0'],
    code: `reader:
  wait(mutex)
  read_count += 1
  if read_count == 1:
    wait(resource)      # first in locks writers out
  signal(mutex)
  READ
  wait(mutex)
  read_count -= 1
  if read_count == 0:
    signal(resource)    # last out lets writers in
  signal(mutex)

writer:
  wait(resource)
  WRITE
  signal(resource)`,
    steps: ['The first reader takes resource, which shuts writers out.', 'Later readers only bump read_count and read at once.', 'The last reader to leave releases resource.', 'A writer takes resource only when no reader holds it.'],
    example: 'R1 and R2 read. W1 arrives and waits. R3 arrives and reads straight away. W1 enters only after R1, R2 and R3 are all gone.',
    pros: ['Highest read concurrency.', 'Simplest to implement and to reason about.'],
    cons: ['Writers can wait a very long time.', 'Wait times are unfair to writers by design.'],
    starvation: 'If a new reader always arrives before the last one leaves, read_count never reaches 0 and a writer waits indefinitely. Run “Starve the writer” and watch W01 and W02.',
    invariants: ['Only the first reader touches resource, so a reader never overlaps a writer.', 'A writer holds resource alone, so two writers never overlap.'],
  },
  {
    id: 'writer-pref', title: 'Writer preference', preset: 'writers-first',
    idea: 'As soon as a writer is waiting, new readers are held at a gate. Readers already inside finish, then the writer goes.',
    semaphores: ['read_try = 1 is the reader gate, held by a writer group', 'mutex_r, mutex_w = 1 protect the two counters', 'resource = 1 is the data itself'],
    code: `reader:
  wait(read_try)          # blocked if any writer is queued
  wait(mutex_r)
  read_count += 1
  if read_count == 1: wait(resource)
  signal(mutex_r)
  signal(read_try)
  READ
  wait(mutex_r)
  read_count -= 1
  if read_count == 0: signal(resource)
  signal(mutex_r)

writer:
  wait(mutex_w)
  write_count += 1
  if write_count == 1: wait(read_try)   # close the gate
  signal(mutex_w)
  wait(resource)
  WRITE
  signal(resource)
  wait(mutex_w)
  write_count -= 1
  if write_count == 0: signal(read_try) # reopen it
  signal(mutex_w)`,
    steps: ['The first waiting writer closes read_try.', 'New readers queue at the gate, one at a time.', 'Readers already inside finish and the last one releases resource.', 'Queued writers run back to back. The last writer reopens the gate.'],
    example: 'R1 reads. W1 arrives and closes the gate. R2 arrives and is stopped at read_try. R1 leaves, W1 writes, then R2 reads.',
    pros: ['Writers do not wait behind a stream of readers.', 'Data gets updated promptly.'],
    cons: ['Readers can wait a long time behind a stream of writers.', 'More semaphores, more ways to get it wrong.'],
    starvation: 'If writers keep arriving, write_count never reaches 0 and the gate stays shut. Readers starve instead.',
    invariants: ['resource still decides who is inside, so the exclusion rules are the same as before.', 'The gate only changes who is allowed to try, never who may enter.'],
  },
  {
    id: 'fair-fifo', title: 'Fair FIFO', preset: 'fair',
    idea: 'Everyone takes a ticket in arrival order. Only the oldest ticket may try to enter, so nobody overtakes anybody.',
    semaphores: ['A ticket queue ordered by arrival', 'mutex = 1 protects read_count', 'resource = 1 as before'],
    code: `reader:
  t = take_ticket()
  wait_until_head(t)        # oldest request only
  wait(mutex)
  read_count += 1
  if read_count == 1: wait(resource)
  signal(mutex)
  leave_queue(t)            # next in line may go
  READ
  ...same exit as reader preference

writer:
  t = take_ticket()
  wait_until_head(t)
  wait(resource)            # holds the head while it waits
  leave_queue(t)
  WRITE
  signal(resource)`,
    steps: ['Each request gets the next ticket number.', 'Only the head of the queue may run the entry protocol.', 'A reader at the head joins the group, then lets the next ticket through.', 'A writer at the head waits for the group to empty and keeps everyone behind it waiting.'],
    example: 'Queue R1, R2, W1, R3. R1 and R2 read together. W1 waits for them. R3 cannot overtake W1, so it reads after W1 finishes.',
    pros: ['No reader or writer is passed over.', 'Wait times track arrival order.'],
    cons: ['Lower read concurrency, because a waiting writer splits reader groups.', 'Python semaphores are not FIFO, so ordering comes from the explicit queue.'],
    starvation: 'Not possible while the head always makes progress. A request cancelled in line leaves the queue and wakes the next one.',
    invariants: ['Admission order equals ticket order.', 'The exclusion rules come from resource, exactly as in the other two.'],
  },
];
