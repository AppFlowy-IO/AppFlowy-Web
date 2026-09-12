use yrs::{Any, Doc, Map, MapPrelim, ReadTxn, StateVector, Transact};

fn main() {
  let doc = Doc::with_client_id(1234);
  let data = doc.get_or_insert_map("data");
  let calendar_setting = {
    let mut txn = doc.transact_mut();
    let database = data.insert(&mut txn, "database", MapPrelim::default());
    let views = database.insert(&mut txn, "views", MapPrelim::default());
    let calendar = views.insert(&mut txn, "calendar", MapPrelim::default());
    let settings = calendar.insert(&mut txn, "layout_settings", MapPrelim::default());
    let setting = settings.insert(&mut txn, "2", MapPrelim::default());
    setting.insert(&mut txn, "layout_ty", Any::BigInt(1));
    setting.insert(&mut txn, "number_of_days", Any::BigInt(2));
    setting.insert(&mut txn, "day_count", Any::BigInt(4));
    setting.insert(&mut txn, "first_day_of_week_v2", Any::BigInt(2));
    setting.insert(&mut txn, "first_day_of_week", Any::BigInt(0));
    setting
  };
  let initial = doc.transact().encode_state_as_update_v1(&StateVector::default());
  let frontier = doc.transact().state_vector();
  std::fs::write("/tmp/calendar-yrs-initial.bin", initial).unwrap();
  calendar_setting.insert(&mut doc.transact_mut(), "day_count", Any::BigInt(8));
  let delta = doc.transact().encode_state_as_update_v1(&frontier);
  std::fs::write("/tmp/calendar-yrs-delta.bin", delta).unwrap();
  let week_frontier = doc.transact().state_vector();
  calendar_setting.insert(&mut doc.transact_mut(), "day_count", Any::BigInt(7));
  let week_delta = doc.transact().encode_state_as_update_v1(&week_frontier);
  std::fs::write("/tmp/calendar-yrs-week-delta.bin", week_delta).unwrap();
}
