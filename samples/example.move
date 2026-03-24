// Vulnerable sample Move contract for demo purposes
// This contract intentionally contains common security issues

module endless::vulnerable_token {
    use std::signer;
    use std::vector;
    use endless_framework::account;
    use endless_framework::timestamp;

    struct TokenStore has key {
        balance: u64,
        owner: address,
    }

    struct AdminCap has key {
        admin: address,
    }

    // VULNERABILITY: Missing access control - anyone can initialize admin
    public fun init_admin(account: &signer) {
        let admin_cap = AdminCap {
            admin: signer::address_of(account),
        };
        move_to(account, admin_cap);
    }

    // VULNERABILITY: Missing acquires annotation
    public fun get_balance(addr: address): u64 {
        borrow_global<TokenStore>(addr).balance
    }

    // VULNERABILITY: Integer overflow - no checked arithmetic
    public fun add_balance(account: &signer, amount: u64) acquires TokenStore {
        let addr = signer::address_of(account);
        let store = borrow_global_mut<TokenStore>(addr);
        store.balance = store.balance + amount; // Can overflow!
    }

    // VULNERABILITY: Randomness from timestamp
    public fun random_airdrop(account: &signer) acquires TokenStore {
        let addr = signer::address_of(account);
        let store = borrow_global_mut<TokenStore>(addr);
        // Using timestamp as randomness - predictable!
        let random = timestamp::now_microseconds() % 1000;
        store.balance = store.balance + random;
    }

    // VULNERABILITY: No signer verification - can drain anyone's tokens
    public fun transfer(from: address, to: address, amount: u64) acquires TokenStore {
        let from_store = borrow_global_mut<TokenStore>(from);
        // Missing: assert!(signer::address_of(caller) == from, ERROR_NOT_AUTHORIZED);
        from_store.balance = from_store.balance - amount; // Can underflow!

        let to_store = borrow_global_mut<TokenStore>(to);
        to_store.balance = to_store.balance + amount;
    }

    // VULNERABILITY: Resource leak - TokenStore created but might not be stored
    public fun create_store_unsafe(account: &signer, initial_balance: u64) {
        let store = TokenStore {
            balance: initial_balance,
            owner: signer::address_of(account),
        };
        // If this errors before move_to, store is leaked
        if (initial_balance > 0) {
            move_to(account, store);
        }
        // else: store is dropped without being destroyed!
    }

    // VULNERABILITY: Public function should be private
    public fun internal_reset_balance(account: &signer) acquires TokenStore {
        let addr = signer::address_of(account);
        let store = borrow_global_mut<TokenStore>(addr);
        store.balance = 0;
    }
}
