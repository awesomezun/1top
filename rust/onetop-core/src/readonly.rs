use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use std::time::Duration;
use url::Url;

/// Exact port of `agent/onetop/observe/readonly.py:connect`.
/// Opens another app's SQLite database read-only (`?mode=ro`). If opening fails with
/// `unable to open` and no `-wal` sidecar exists, retries with `?mode=ro&immutable=1`.
pub fn open_readonly(path: &Path, timeout_secs: f64) -> Result<Connection, rusqlite::Error> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };
    let base_uri = Url::from_file_path(&abs)
        .map_err(|()| rusqlite::Error::InvalidPath(abs.clone()))?
        .to_string();
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_URI
        | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let timeout = Duration::from_secs_f64(timeout_secs.max(0.0));

    let ro_uri = format!("{base_uri}?mode=ro");
    let first_attempt = Connection::open_with_flags(&ro_uri, flags).and_then(|conn| {
        conn.busy_timeout(timeout)?;
        conn.query_row("SELECT 1 FROM sqlite_master LIMIT 1", [], |_| Ok(()))
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(()),
                other => Err(other),
            })?;
        Ok(conn)
    });

    match first_attempt {
        Ok(conn) => Ok(conn),
        Err(err) => {
            let msg = err.to_string().to_lowercase();
            let wal_exists = Path::new(&format!("{}-wal", abs.display())).exists();
            if !msg.contains("unable to open") || wal_exists {
                return Err(err);
            }
            let imm_uri = format!("{base_uri}?mode=ro&immutable=1");
            let conn = Connection::open_with_flags(&imm_uri, flags)?;
            conn.busy_timeout(timeout)?;
            Ok(conn)
        }
    }
}
