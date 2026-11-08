// cargo-near's ABI pass (host build with near-sdk/__abi-generate) sets CARGO_NEAR_ABI_GENERATION. The `near_abi` cfg
// turns on the schema impls for the small Map type, which only exist in that pass (never in the wasm).
fn main() {
    println!("cargo::rustc-check-cfg=cfg(near_abi)");
    println!("cargo::rerun-if-env-changed=CARGO_NEAR_ABI_GENERATION");
    if std::env::var("CARGO_NEAR_ABI_GENERATION").as_deref() == Ok("true") { println!("cargo::rustc-cfg=near_abi"); }
}
