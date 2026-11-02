# SyncLab — Reader–Writer Synchronization Simulator

An interactive operating-systems laboratory for understanding concurrent readers, exclusive writers, semaphore behavior, synchronization fairness, and starvation.

Built using **FastAPI**, **Python threading primitives**, **WebSockets**, **React 19**, **Vite**, **TypeScript**, and **Tailwind CSS**, designed under strict technical, editorial **Hallmark** light-theme design principles.

---

## 1. System Architecture

```
synclab/
├── backend/
│   ├── app/
│   │   ├── main.py                   # FastAPI REST API + WebSocket streaming server
│   │   └── sync/
│   │       ├── models.py             # Pydantic schemas for events, metrics, processes
│   │       ├── resource.py           # Thread-safe SharedResource with invariant enforcement
│   │       ├── algorithms.py         # Reader Preference, Writer Preference, Fair FIFO
│   │       └── engine.py             # SimulationEngine, thread lifecycle & metrics
│   └── tests/
│       ├── test_synchronization.py   # Concurrency, mutex exclusivity, and fairness tests
│       └── test_api.py               # REST API lifecycle and input validation tests
│
├── frontend/
│   ├── src/
│   │   ├── components/               # StatusIndicator, SharedResource, ProcessCard, etc.
│   │   ├── views/                    # Overview, Simulator, Comparison, Timeline, Results, Learning
│   │   ├── hooks/                    # useSimulation (WebSocket reconnect with event recovery)
│   │   ├── services/                 # Typed API client
│   │   ├── types/                    # TypeScript domain interfaces
│   │   ├── App.tsx                   # Main App shell and responsive navigation
│   │   ├── App.test.tsx              # Vitest frontend unit tests
│   │   └── index.css                 # Hallmark technical light design tokens
│   ├── dist/                         # Verified production build
│   └── package.json
│
├── start_backend.bat                 # One-click backend launcher
├── start_frontend.bat                # One-click frontend launcher
└── start_all.bat                     # Full-stack launcher
```

---

## 2. Formal Safety Invariants

1. **Reader-Writer Exclusion:** No reader may hold a read lease while a writer holds an exclusive write lease (`InvariantViolationError` raised on breach).
2. **Writer Mutual Exclusion:** At most one writer may access the resource at any given moment.
3. **Reader Concurrency:** Multiple compatible reader threads may access the shared memory segment concurrently.
4. **Monotonic Versioning:** Every committed write atomically increments the resource version counter (`v1, v2, v3...`).
5. **Clean Cancellation:** Stopping or resetting signals all active worker threads via POSIX-compliant thread events without thread or semaphore leakage.

---

## 3. Implemented Synchronization Algorithms

### Algorithm 1: Reader Preference (Courtois et al. 1971)
* **Mechanics:** The first arriving reader locks the shared resource (`resource_lock.acquire()`). Subsequent readers bypass the lock and read concurrently. The last exiting reader unlocks the resource (`resource_lock.release()`).
* **Consequence:** Writers wait as long as `read_count > 0`. A continuous stream of readers can cause **indefinite writer starvation**.

### Algorithm 2: Writer Preference (Courtois et al. 1971)
* **Mechanics:** When any writer queues, it acquires the `read_try` gate. Newly arriving readers are blocked at `read_try` and cannot enter. Active readers finish, after which the waiting writer claims the resource lock.
* **Consequence:** Writers receive priority service. A continuous stream of writers can cause **reader starvation**.

### Algorithm 3: Fair FIFO Admission (Starvation-Free Turnstile)
* **Mechanics:** All arriving threads pass through a single-ticket FIFO turnstile (`order_queue`). Consecutive readers still execute concurrently, but newly arriving readers cannot bypass an earlier queued writer.
* **Consequence:** Strictly fair request ordering. **Zero starvation** for both readers and writers.

---

## 4. How to Run

### Option A: Automated One-Click Launchers (Windows)
Double-click `start_all.bat` (or run `start_backend.bat` and `start_frontend.bat` in separate windows).

### Option B: Manual Terminal Execution

#### 1. Start the Backend:
```powershell
cd synclab/backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
* Backend runs at: `http://127.0.0.1:8000`
* Interactive OpenAPI Swagger docs: `http://127.0.0.1:8000/docs`

#### 2. Start the Frontend:
```powershell
cd synclab/frontend
npm run dev
```
* Frontend runs at: `http://localhost:5173` (proxies `/api` and `/ws` to port 8000)

*Note:* The backend also directly serves the compiled frontend production bundle from `frontend/dist/` at `http://127.0.0.1:8000/`.

---

## 5. Automated Test Results

### Backend Concurrency & API Suite (Pytest)
```powershell
cd synclab/backend
python -m pytest tests -v
```
**Actual Output:**
```
============================= test session starts =============================
tests/test_api.py::test_health_check PASSED                              [  8%]
tests/test_api.py::test_simulation_lifecycle PASSED                      [ 16%]
tests/test_api.py::test_config_validation PASSED                         [ 25%]
tests/test_api.py::test_events_and_export PASSED                         [ 33%]
tests/test_synchronization.py::test_shared_resource_invariants PASSED    [ 41%]
tests/test_synchronization.py::test_concurrent_readers_allowed PASSED    [ 50%]
tests/test_synchronization.py::test_reader_preference_writer_waits PASSED [ 58%]
tests/test_synchronization.py::test_writer_preference_blocks_incoming_readers PASSED [ 66%]
tests/test_synchronization.py::test_fair_fifo_ordering PASSED            [ 75%]
tests/test_synchronization.py::test_simulation_engine_full_run PASSED    [ 83%]
tests/test_synchronization.py::test_simulation_clean_cancellation PASSED [ 91%]
tests/test_synchronization.py::test_simulation_pause_resume PASSED       [100%]
============================= 12 passed in 5.64s ==============================
```

### Frontend Component & State Suite (Vitest)
```powershell
cd synclab/frontend
npm run test
```
**Actual Output:**
```
 RUN  v3.2.7 C:/Users/I Terish charan tej/Downloads/OS/synclab/frontend
 ✓ src/App.test.tsx (4 tests) 13ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

---

## 6. Advanced Synchronization & Systems Engineering Notes

### 6.1 Cooperative Mid-Flight Pause/Resume & Lease Safety
* **The Classical Trap:** Arbitrarily suspending an in-flight OS thread holding an acquired mutex/semaphore via raw kernel signals (`SIGSTOP` or `SuspendThread`) induces priority inversion and immediate deadlock: other threads waiting on that lock cannot make progress, and if the supervisor depends on downstream state, the process hangs.
* **SyncLab's Solution:** SyncLab implements **cooperative slice barriers**. Worker threads check a `pause_event` condition every 20ms:
  1. If paused while in the critical section, the thread **retains its acquired lease** (`resource_lock` or reader count), freezing its progress bar without releasing locks prematurely.
  2. If paused while waiting in line, the thread stays queued without losing its turnstile position.
  3. When resumed, `pause_event.set()` signals workers to immediately resume execution.
  4. **Time Dilation:** Cumulative paused durations (`total_paused_sec`) are subtracted from monotonic execution timestamps so throughput, duration, and waiting-time metrics remain mathematically unskewed.

### 6.2 CPython GIL Concurrency & Windows Kernel Scheduling
* **Mechanism:** While Python utilizes a Global Interpreter Lock (GIL) for bytecode execution, CPython's synchronization primitives (`threading.Semaphore`, `threading.Lock`, and `threading.Event.wait()`) are implemented in C using `Py_BEGIN_ALLOW_THREADS` and `Py_END_ALLOW_THREADS`.
* **OS-Level Preemption:** When a reader or writer thread invokes `sem.acquire()` or performs simulation delays (`stop_event.wait(timeout)`), Python releases the GIL completely. Thread blocking, wakeups, and contention arbitration are delegated directly to the Windows kernel scheduler (`WaitForSingleObjectEx`). This accurately models true preemptive OS multitasking and hardware cache contention.

### 6.3 High-Density Scalability (100 Readers & 50 Writers)
* The workload engine supports up to **100 reader threads** and **50 writer threads** concurrently.
* The frontend visualization provides an information-dense, scrollable grid with segmented state filters (`ALL`, `ACTIVE`, `WAITING`, `COMPLETED`), allowing operators to monitor large thread pools without browser slowdown.

---

## 7. Visual Design System (The Concurrency Workbench)

* **Design Standard:** Audited and verified against Hallmark rules with `sloplint.mjs` returning **clean (0 FAIL, 0 REFLEX, 0 WARN)**.
* **Concurrency Workbench Tokens:**
  * Canvas: Warm neutral `#F7F7F4` (`--color-paper`)
  * Primary Surfaces: Clean neutral `#FCFCFA` (`--color-surface`)
  * Elevated Neutral: `#F0F0EC` (`--color-surface-elevated`)
  * Borders / Hairlines: Fine 1px neutral `#E5E5DE` (`--color-rule`)
  * Primary Ink: Deep charcoal `#242622` (`--color-ink`)
  * Secondary Text: Restrained warm gray `#74766F` (`--color-ink-muted`)
  * Primary Accent: Muted industrial teal `#426B63` (`--color-accent`)
  * Reader Activity: Restrained green `#56816B` (`--state-reader`)
  * Writer Activity: Terracotta / copper `#B66C4F` (`--state-writer`)
  * Waiting Processes: Warm amber `#B18A45` (`--state-waiting`)
  * Critical / Deadlock: Controlled red `#B94C43` (`--state-critical`)
* **Typography:** `Geist` / `Inter` (technical UI typography) and `Geist Mono` / `JetBrains Mono` (PIDs, wait times, addresses, telemetry & trace steps).
* **Strict Anti-Slop Discipline:**
  * Zero blue-purple gradients, zero neon glows, zero cards inside cards.
  * Zero fake metrics: every displayed number and event is verified by backend telemetry.
  * Hairline 1px borders, zero drop shadows (`--shadow-card: none`), razor corner radiuses `rounded-[2px]`.
  * Physical systems instrument architecture: Concurrent Reader Bus, Protected Register 0x01, and Exclusive Writer Clamp.

