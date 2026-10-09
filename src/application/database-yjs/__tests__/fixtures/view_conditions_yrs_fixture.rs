use yrs::{Any, Array, ArrayPrelim, Doc, Map, MapPrelim, ReadTxn, StateVector, Transact};

fn main() -> std::io::Result<()> {
  let doc = Doc::with_client_id(1234);
  let data = doc.get_or_insert_map("data");
  let (filter, sort) = {
    let mut txn = doc.transact_mut();
    let database = data.insert(&mut txn, "database", MapPrelim::default());
    let views = database.insert(&mut txn, "views", MapPrelim::default());
    let view = views.insert(&mut txn, "view-1", MapPrelim::default());
    view.insert(&mut txn, "id", "view-1");
    let filters = view.insert(&mut txn, "filters", ArrayPrelim::default());
    let filter = filters.push_back(&mut txn, MapPrelim::default());
    filter.insert(&mut txn, "id", "filter-1");
    filter.insert(&mut txn, "field_id", "person");
    filter.insert(&mut txn, "condition", Any::BigInt(1));
    filter.insert(&mut txn, "ty", Any::BigInt(10));
    filter.insert(&mut txn, "filter_type", Any::BigInt(2));
    filter.insert(&mut txn, "content", "[]");
    let sorts = view.insert(&mut txn, "sorts", ArrayPrelim::default());
    let sort = sorts.push_back(&mut txn, MapPrelim::default());
    sort.insert(&mut txn, "id", "sort-1");
    sort.insert(&mut txn, "field_id", "person");
    sort.insert(&mut txn, "condition", Any::BigInt(1));
    (filter, sort)
  };
  let initial = doc.transact().encode_state_as_update_v1(&StateVector::default());
  let frontier = doc.transact().state_vector();
  std::fs::write("/tmp/view-conditions-yrs-initial.bin", initial)?;
  {
    let mut txn = doc.transact_mut();
    filter.insert(&mut txn, "condition", Any::BigInt(0));
    sort.insert(&mut txn, "condition", Any::BigInt(0));
  }
  let delta = doc.transact().encode_state_as_update_v1(&frontier);
  std::fs::write("/tmp/view-conditions-yrs-delta.bin", delta)
}
