#![forbid(unsafe_code)]

use onetop_core::{
    antigravity, devin, effort, observers, pricing, processes, resources, transcripts,
};
use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;
use pyo3::types::{PyBool, PyBytes, PyDict, PyFloat, PyList, PyNone, PyString};
use pyo3::IntoPyObjectExt;
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

fn wire_err_to_py(e: antigravity::WireError) -> PyErr {
    PyValueError::new_err(e.to_string())
}

fn json_to_py(py: Python<'_>, val: &serde_json::Value) -> PyResult<Py<PyAny>> {
    match val {
        serde_json::Value::Null => Ok(PyNone::get(py).to_owned().into_any().unbind()),
        serde_json::Value::Bool(b) => Ok(PyBool::new(py, *b).to_owned().into_any().unbind()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.into_py_any(py)
            } else if let Some(u) = n.as_u64() {
                u.into_py_any(py)
            } else if let Some(f) = n.as_f64() {
                Ok(PyFloat::new(py, f).into_any().unbind())
            } else {
                Ok(PyNone::get(py).to_owned().into_any().unbind())
            }
        }
        serde_json::Value::String(s) => Ok(PyString::new(py, s).into_any().unbind()),
        serde_json::Value::Array(arr) => {
            let list = PyList::empty(py);
            for item in arr {
                list.append(json_to_py(py, item)?)?;
            }
            Ok(list.into_any().unbind())
        }
        serde_json::Value::Object(map) => {
            let dict = PyDict::new(py);
            for (k, v) in map {
                dict.set_item(k, json_to_py(py, v)?)?;
            }
            Ok(dict.into_any().unbind())
        }
    }
}

fn btree_map_to_py_dict(
    py: Python<'_>,
    map: &BTreeMap<String, serde_json::Value>,
) -> PyResult<Py<PyDict>> {
    let dict = PyDict::new(py);
    for (k, v) in map {
        dict.set_item(k, json_to_py(py, v)?)?;
    }
    Ok(dict.unbind())
}

fn timestamp_py(py: Python<'_>, t: f64) -> PyResult<Py<PyAny>> {
    if t == 0.0 {
        0i64.into_py_any(py)
    } else {
        Ok(PyFloat::new(py, t).into_any().unbind())
    }
}

// ---------------- Wave 0: Antigravity / Devin / Transcripts / Pricing ----------------

#[pyfunction]
fn ag_fields(py: Python<'_>, data: &[u8]) -> PyResult<Py<PyDict>> {
    let parsed = antigravity::decode_fields(data).map_err(wire_err_to_py)?;
    let out = PyDict::new(py);
    for (num, vals) in parsed {
        let list = PyList::empty(py);
        for v in vals {
            match v {
                antigravity::WireValue::Varint(n) => list.append(n)?,
                antigravity::WireValue::Bytes(b) => list.append(PyBytes::new(py, &b))?,
            }
        }
        out.set_item(num, list)?;
    }
    Ok(out.unbind())
}

#[pyfunction]
fn ag_response(py: Python<'_>, metadata: &[u8]) -> PyResult<Option<Py<PyDict>>> {
    let Some(resp) = antigravity::parse_response(metadata).map_err(wire_err_to_py)? else {
        return Ok(None);
    };
    let out = PyDict::new(py);
    out.set_item("id", resp.id)?;
    out.set_item("tokens", resp.tokens.to_vec())?;
    out.set_item("model", resp.model)?;
    out.set_item("t", timestamp_py(py, resp.t)?)?;
    Ok(Some(out.unbind()))
}

#[pyfunction]
fn ag_usage(
    py: Python<'_>,
    path: &str,
    after: i64,
    known_models: &Bound<'_, PyDict>,
) -> PyResult<(i64, Py<PyList>, Py<PyDict>)> {
    let mut known: BTreeMap<u128, String> = BTreeMap::new();
    for (k, v) in known_models.iter() {
        if let (Ok(num), Ok(name)) = (k.extract::<u128>(), v.extract::<String>()) {
            known.insert(num, name);
        }
    }
    let (last_idx, rows, numbers) = antigravity::read_usage(Path::new(path), after, &known)
        .map_err(|e| match e {
            antigravity::AntigravityError::Wire(w) => wire_err_to_py(w),
            antigravity::AntigravityError::Sqlite(s) => {
                PyRuntimeError::new_err(format!("SQLITE:{s}"))
            }
        })?;

    let py_rows = PyList::empty(py);
    for r in rows {
        let d = PyDict::new(py);
        d.set_item("id", r.id)?;
        d.set_item("tokens", r.tokens.to_vec())?;
        d.set_item("model", r.model)?;
        d.set_item("t", timestamp_py(py, r.t)?)?;
        d.set_item("idx", r.idx)?;
        py_rows.append(d)?;
    }
    let py_nums = PyDict::new(py);
    for (k, v) in numbers {
        py_nums.set_item(k, v)?;
    }
    Ok((last_idx, py_rows.unbind(), py_nums.unbind()))
}

#[pyfunction]
#[pyo3(signature = (uris=None))]
fn ag_workspace(uris: Option<&str>) -> String {
    antigravity::workspace_from_uris(uris)
}

#[pyfunction]
fn ag_catalog(py: Python<'_>, root: &str) -> PyResult<Py<PyDict>> {
    let rows = antigravity::read_catalog(Path::new(root));
    let out = PyDict::new(py);
    for (cid, row) in rows {
        let d = PyDict::new(py);
        d.set_item("id", row.id)?;
        d.set_item("title", row.title)?;
        d.set_item("cwd", row.cwd)?;
        d.set_item("status", row.status)?;
        d.set_item("modified", timestamp_py(py, row.modified)?)?;
        d.set_item("root", row.root)?;
        match row.parent {
            Some(p) => d.set_item("parent", p)?,
            None => d.set_item("parent", PyNone::get(py))?,
        }
        out.set_item(cid, d)?;
    }
    Ok(out.unbind())
}

#[pyfunction]
fn devin_sessions(py: Python<'_>, path: &str, now: f64, window: f64) -> PyResult<Py<PyList>> {
    let rows = devin::read_sessions(Path::new(path), now, window);
    let out = PyList::empty(py);
    for r in rows {
        let d = PyDict::new(py);
        d.set_item("id", r.id)?;
        d.set_item("cwd", r.cwd)?;
        d.set_item("model", r.model)?;
        d.set_item("title", r.title)?;
        d.set_item("created", timestamp_py(py, r.created)?)?;
        d.set_item("updated", timestamp_py(py, r.updated)?)?;
        d.set_item("status", r.status)?;
        d.set_item("status_at", timestamp_py(py, r.status_at)?)?;
        out.append(d)?;
    }
    Ok(out.unbind())
}

#[pyfunction]
#[pyo3(signature = (path, after=0, now=None, limit=5000))]
fn devin_usage(
    py: Python<'_>,
    path: &str,
    after: i64,
    now: Option<f64>,
    limit: i64,
) -> PyResult<(i64, Py<PyList>)> {
    let (last, rows) = devin::read_usage(Path::new(path), after, now, limit)
        .map_err(|s| PyRuntimeError::new_err(format!("SQLITE:{s}")))?;
    let out = PyList::empty(py);
    for r in rows {
        let d = PyDict::new(py);
        d.set_item("session", r.session)?;
        d.set_item("id", r.id)?;
        d.set_item("t", timestamp_py(py, r.t)?)?;
        d.set_item("model", r.model)?;
        d.set_item("tokens", r.tokens.to_vec())?;
        d.set_item("session_model", r.session_model)?;
        d.set_item("cwd", r.cwd)?;
        d.set_item("title", r.title)?;
        out.append(d)?;
    }
    Ok((last, out.unbind()))
}

#[pyfunction]
fn transcript_facts(py: Python<'_>, raw: &[u8]) -> PyResult<Py<PyList>> {
    let events = transcripts::parse_facts(raw);
    let out = PyList::empty(py);
    for ev in events {
        out.append(btree_map_to_py_dict(py, &ev)?)?;
    }
    Ok(out.unbind())
}

#[pyfunction]
#[pyo3(signature = (model=None))]
fn pricing_normalize(model: Option<&str>) -> String {
    pricing::normalize(model)
}

#[pyfunction]
#[pyo3(signature = (model=None))]
fn pricing_price(model: Option<&str>) -> Option<(f64, f64, f64, f64)> {
    pricing::price(model)
}

#[pyfunction]
#[pyo3(signature = (model, tokens))]
fn pricing_value(model: Option<&str>, tokens: Vec<f64>) -> Option<f64> {
    pricing::value(model, &tokens)
}

#[pyfunction]
fn pricing_plan(kind: &str, plan_name: &str, tier: &str) -> (String, String, Option<i64>) {
    let info = pricing::plan(kind, plan_name, tier);
    (info.plan, info.label, info.price)
}

// ---------------- Wave 2: Processes / Resources / Effort / Observers ----------------

#[pyfunction]
#[pyo3(signature = (name, args, exe=""))]
fn proc_cli_kind(name: &str, args: Vec<String>, exe: &str) -> Option<&'static str> {
    processes::cli_kind(name, &args, exe)
}

#[pyfunction]
fn proc_explicit_session(args: Vec<String>) -> Option<String> {
    processes::explicit_session(&args)
}

#[pyfunction]
fn proc_argv_shape(args: Vec<String>) -> Vec<String> {
    processes::argv_shape(&args)
}

#[pyfunction]
#[pyo3(signature = (path, name=""))]
fn proc_app_from(path: &str, name: &str) -> (String, String) {
    processes::app_from(path, name)
}

#[pyfunction]
#[pyo3(signature = (value=None))]
fn effort_level(value: Option<&str>) -> Option<String> {
    let v = value.map(|s| serde_json::Value::String(s.to_string()));
    effort::level(v.as_ref())
}

#[pyfunction]
#[pyo3(signature = (current, previous=None))]
fn res_host_cpu_percent(
    current: BTreeMap<String, f64>,
    previous: Option<BTreeMap<String, f64>>,
) -> Option<f64> {
    resources::host_cpu_percent(&current, previous.as_ref())
}

#[pyfunction]
#[pyo3(signature = (home, now, window=86400.0))]
fn obs_openmausbot_read(py: Python<'_>, home: &str, now: f64, window: f64) -> PyResult<Py<PyList>> {
    let rows = observers::read_openmausbot(Path::new(home), now, window);
    let out = PyList::empty(py);
    for r in rows {
        let d = PyDict::new(py);
        d.set_item("id", r.id)?;
        d.set_item("turns", r.turns)?;
        d.set_item("updated", timestamp_py(py, r.updated)?)?;
        d.set_item("bot", r.bot)?;
        d.set_item("kind", r.kind)?;
        d.set_item("model", r.model)?;
        out.append(d)?;
    }
    Ok(out.unbind())
}

#[pyfunction]
fn obs_openbot_read(py: Python<'_>, home: &str) -> PyResult<Py<PyList>> {
    let rows = observers::read_openbot_agents(Path::new(home));
    let out = PyList::empty(py);
    for r in rows {
        let d = PyDict::new(py);
        d.set_item("workspace", r.workspace)?;
        d.set_item("name", r.name)?;
        out.append(d)?;
    }
    Ok(out.unbind())
}

#[pyclass]
struct PyResourceSampler {
    inner: resources::NativeResourceSampler,
}

#[pymethods]
impl PyResourceSampler {
    #[new]
    fn new() -> Self {
        Self {
            inner: resources::NativeResourceSampler::new(),
        }
    }

    fn sample(
        &mut self,
        py: Python<'_>,
        session_candidates: HashMap<String, Vec<(u32, Option<f64>)>>,
        shared_roots: Vec<u32>,
    ) -> PyResult<(Py<PyAny>, Py<PyAny>)> {
        let (snap, groups) = self.inner.sample(&session_candidates, &shared_roots);
        let snap_val =
            serde_json::to_value(&snap).map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        let groups_val =
            serde_json::to_value(&groups).map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        Ok((json_to_py(py, &snap_val)?, json_to_py(py, &groups_val)?))
    }
}

#[pymodule]
fn _onetop_rs(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(ag_fields, m)?)?;
    m.add_function(wrap_pyfunction!(ag_response, m)?)?;
    m.add_function(wrap_pyfunction!(ag_usage, m)?)?;
    m.add_function(wrap_pyfunction!(ag_workspace, m)?)?;
    m.add_function(wrap_pyfunction!(ag_catalog, m)?)?;
    m.add_function(wrap_pyfunction!(devin_sessions, m)?)?;
    m.add_function(wrap_pyfunction!(devin_usage, m)?)?;
    m.add_function(wrap_pyfunction!(transcript_facts, m)?)?;
    m.add_function(wrap_pyfunction!(pricing_normalize, m)?)?;
    m.add_function(wrap_pyfunction!(pricing_price, m)?)?;
    m.add_function(wrap_pyfunction!(pricing_value, m)?)?;
    m.add_function(wrap_pyfunction!(pricing_plan, m)?)?;
    m.add_function(wrap_pyfunction!(proc_cli_kind, m)?)?;
    m.add_function(wrap_pyfunction!(proc_explicit_session, m)?)?;
    m.add_function(wrap_pyfunction!(proc_argv_shape, m)?)?;
    m.add_function(wrap_pyfunction!(proc_app_from, m)?)?;
    m.add_function(wrap_pyfunction!(effort_level, m)?)?;
    m.add_function(wrap_pyfunction!(res_host_cpu_percent, m)?)?;
    m.add_function(wrap_pyfunction!(obs_openmausbot_read, m)?)?;
    m.add_function(wrap_pyfunction!(obs_openbot_read, m)?)?;
    m.add_class::<PyResourceSampler>()?;
    Ok(())
}
