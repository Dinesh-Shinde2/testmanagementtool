export type Role = "ADMIN" | "QA" | "VIEWER";
export type ExecStatus = "NOT_EXECUTED" | "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
};

export type Project = {
  id: string;
  name: string;
  key: string;
  description: string;
  member_count?: number;
  archived?: boolean;
  created_at?: string | null;
};

export type ActivityItem = {
  id: string;
  project_id?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  action: string;
  message: string;
  entity_type?: string;
  entity_id?: string | null;
  created_at?: string | null;
};

export type Module = { id: string; project_id: string; name: string; parent_id: string | null };

export type ExecCounts = {
  total: number;
  pass: number;
  fail: number;
  blocked: number;
  skipped: number;
  not_executed: number;
};

export type BugFlow = {
  ever_failed?: number;
  failed: number;
  bugs_raised: number;
  open?: number;
  resolved: number;
  retest_ready: number;
  passed_after_retest?: number;
  retest_pass: number;
};

export type CaseFolder = {
  id: string;
  project_id: string;
  sprint_id: string | null;
  parent_id: string | null;
  name: string;
  kind: "SPRINT" | "WORK";
  child_count: number;
  case_count: number;
  path: Array<{ id: string; name: string; kind: string }>;
  exec?: ExecCounts;
  flow?: BugFlow;
  sprint_code?: string | null;
  sprint_name?: string | null;
};
export type Sprint = {
  id: string;
  project_id: string;
  name: string;
  code: string;
  description?: string;
  start_date: string | null;
  end_date: string | null;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
  module_count?: number;
  case_count?: number;
  executed?: number;
  pass?: number;
  fail?: number;
  blocked?: number;
  skipped?: number;
  not_executed?: number;
  can_delete?: boolean;
  linked?: {
    modules: number;
    cases: number;
    plans: number;
    runs: number;
    requirements: number;
  };
};

export type Requirement = {
  id: string;
  req_id: string;
  title: string;
  description: string;
  priority: string;
  sprint_id: string | null;
  folder_id?: string | null;
  module_name?: string;
  case_ids: string[];
  case_count?: number;
};

export type TestStep = { id?: string; step_no: number; action: string; expected_result: string };

export type TestCase = {
  id: string;
  project_id: string;
  module_id: string | null;
  module_name: string | null;
  folder_id: string | null;
  case_id: string;
  title: string;
  description: string;
  preconditions: string;
  test_data: string;
  priority: string;
  type: string;
  status: string;
  steps: TestStep[];
  requirement_ids: string[];
  requirement_codes: string[];
};

export type Plan = {
  id: string;
  sprint_id: string;
  sprint_name?: string | null;
  name: string;
  item_count: number;
  test_case_ids: string[];
};

export type Run = {
  id: string;
  plan_id: string;
  sprint_id: string;
  plan_name?: string | null;
  sprint_name?: string | null;
  name: string;
  status: string;
  started_at: string;
  total?: number;
  pass?: number;
  fail?: number;
  blocked?: number;
  skipped?: number;
  not_executed?: number;
};

export type ExecutionStep = {
  id: string;
  step_no: number;
  action: string;
  expected_result: string;
  status: ExecStatus;
  actual_result: string;
};

export type Attachment = { id: string; file_name: string; url: string; content_type: string };

export type Execution = {
  id: string;
  run_id: string;
  test_case_id: string;
  folder_id?: string | null;
  case_id: string | null;
  title: string | null;
  priority: string | null;
  preconditions: string;
  test_data: string;
  status: ExecStatus;
  actual_result: string;
  comment: string;
  executed_by_name: string | null;
  executed_at: string | null;
  steps: ExecutionStep[];
  attachments: Attachment[];
  defects?: Defect[];
};

export type ExecuteView = {
  folder: CaseFolder | null;
  children: CaseFolder[];
  run: Run | null;
  executions: Execution[];
  exec: ExecCounts;
  flow?: BugFlow;
};

export type ExecutionEvent = {
  id: string;
  status: string;
  actual_result: string;
  executed_by_name?: string | null;
  executed_at?: string | null;
};

export type Defect = {
  id: string;
  bug_id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  stage?: string;
  stage_label?: string;
  stage_path?: string[];
  original_result?: string;
  original_actual?: string;
  current_result?: string | null;
  ever_failed?: number;
  passed_after_retest?: number;
  can_mark_pass?: boolean;
  history?: ExecutionEvent[];
  story?: string;
  case_id: string | null;
  test_case_id?: string | null;
  case_title?: string | null;
  case_priority?: string | null;
  folder_id?: string | null;
  module_name?: string;
  execution_id: string | null;
  attachments?: Attachment[];
  created_by_name: string | null;
  executed_by_name?: string | null;
  executed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type Kpis = {
  total: number;
  executed: number;
  pass: number;
  fail: number;
  blocked: number;
  skipped: number;
  not_executed: number;
  pass_rate: number;
};

export type Dashboard = {
  project: { id: string; name: string; key: string };
  sprint: { id: string; name: string; code: string; status: string; start_date?: string | null; end_date?: string | null } | null;
  sprint_folder_id?: string | null;
  run: { id: string; name: string } | null;
  completed?: boolean;
  kpis: Kpis;
  sprint_series: Array<{ sprint_id: string; name: string; code: string; status: string } & Kpis>;
  module_stats: Array<{
    id?: string | null;
    name: string;
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
    not_executed: number;
    total: number;
    executed?: number;
    pass_rate?: number | null;
    ever_failed?: number;
    passed_after_retest?: number;
  }>;
  modules?: Array<{ id: string; name: string }>;
  rtm: { total: number; covered: number; percent: number };
  open_defects: number;
  bug_flow?: BugFlow;
  bug_stories?: Array<{
    id: string;
    case_id: string;
    title: string;
    bug_id: string;
    status: string;
    original_result: string;
    current_result: string;
    story: string;
  }>;
  recent: Array<{
    id: string;
    run_id?: string;
    case_id: string;
    title: string;
    status: string;
    executed_by_name: string;
    executed_at: string | null;
    module?: string;
    folder_id?: string | null;
    retest?: boolean;
  }>;
  sprints: Array<{ id: string; name: string; code: string; status: string; start_date?: string | null; end_date?: string | null }>;
};

export type Rtm = {
  sprint_id: string | null;
  sprint?: { id: string; name: string; code: string; status: string } | null;
  sprints?: Array<{ id: string; name: string; code: string; status: string }>;
  modules?: Array<{ id: string; name: string }>;
  folder_id?: string | null;
  run_name: string | null;
  run_id?: string | null;
  kpis?: Omit<Kpis, "pass_rate"> & {
    pass_rate: number | null;
    ever_failed?: number;
    passed_after_retest?: number;
  };
  module_stats?: Dashboard["module_stats"];
  total: number;
  covered: number;
  percent: number;
  rows: Array<{
    id: string;
    req_id: string;
    title: string;
    priority: string;
    module?: string;
    covered: boolean;
    latest_result?: string;
    cases: Array<{
      id: string;
      case_id: string;
      title: string;
      status: string;
      in_run: boolean;
      folder_id?: string | null;
      module?: string;
    }>;
  }>;
};

export type ExecutionReport = {
  project: { id: string; name: string; key: string };
  generated_at?: string | null;
  last_executed_at?: string | null;
  filters?: Record<string, string | null>;
  sprints: Array<{ id: string; name: string; code: string; status: string; start_date?: string | null; end_date?: string | null }>;
  modules: Array<{ id: string; name: string; sprint_id: string | null; sprint_code?: string }>;
  kpis: Omit<Kpis, "pass_rate"> & {
    ever_failed: number;
    passed_after_retest: number;
    never_failed: number;
    pass_pct: number | null;
    fail_pct: number | null;
    blocked_pct: number | null;
    not_executed_pct: number | null;
    ever_failed_pct: number | null;
    passed_after_retest_pct: number | null;
    never_failed_pct: number | null;
    pass_rate: number | null;
  };
  distribution: { pass: number; fail: number; blocked: number; skipped: number; not_executed: number };
  history_summary: { never_failed: number; ever_failed: number; passed_after_retest: number; still_failed: number };
  trend: Array<{
    run_id: string;
    name: string;
    sprint_id: string;
    started_at: string | null;
    pass: number;
    fail: number;
    blocked: number;
    not_executed: number;
  }>;
  sprint_summary: Array<{
    id: string;
    code: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    status: string;
    module_count: number;
    total: number;
    executed: number;
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
    not_executed: number;
    pass_rate: number | null;
    ever_failed: number;
    passed_after_retest: number;
  }>;
  module_summary: Array<{
    id: string;
    name: string;
    sprint_id: string | null;
    sprint_code: string;
    total: number;
    executed: number;
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
    not_executed: number;
    pass_rate: number | null;
    ever_failed: number;
    passed_after_retest: number;
  }>;
  details: Array<{
    id: string;
    case_id: string;
    title: string;
    sprint_id: string | null;
    sprint_code: string;
    sprint_name: string;
    folder_id: string | null;
    module: string;
    priority: string;
    type: string;
    status: string;
    ever_failed: number;
    passed_after_retest: number;
    ever_failed_flag: boolean;
    passed_after_retest_flag: boolean;
    executed_at: string | null;
    executed_by: string;
  }>;
};

export type SprintReport = {
  project: { name: string; key: string };
  sprint: Sprint;
  run: { id: string; name: string } | null;
  kpis: Kpis;
  module_stats: Dashboard["module_stats"];
  tester_stats: Array<{ name: string; pass: number; fail: number; blocked: number; skipped: number; total: number }>;
  details: Array<{
    case_id: string;
    title: string;
    module: string;
    priority: string;
    status: string;
    actual_result: string;
    executed_by: string;
    executed_at: string | null;
  }>;
  defects: Array<{ title: string; severity: string; status: string; case_id: string }>;
  rtm: Rtm;
};
