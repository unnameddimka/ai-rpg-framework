# Current Tavern World — Keys, Beds, and Common-room Cleanup

Base implementation: `6afbfdd71d4156fb8d3d81568d344ec9a2ac2ee9`.

- Add a third common-room table using the same sublocation, capacity, reachability, `place_item`, and inventory mechanics as the first two tables.
- Remove static common-room prose that invents travellers/merchants who do not exist as canonical character entities.
- Convert the innkeeper-room and four guest-room doors from generic permanently blocked transitions to lockable reciprocal passages.
- Garrick starts with five ordinary key instances, one for each distinct room lock.
- Each key name identifies its room and each key definition has exactly one matching `keyLockId`.
- Add a bed sublocation to the innkeeper room and all four guest rooms.
- Beds are deliberately multi-occupancy for now and behave exactly like ordinary sublocations: `Lie down on the bed` moves the actor to that sublocation and the authored position text describes them as lying; moving back to the floor gets up.
