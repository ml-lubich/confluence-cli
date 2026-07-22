# Homebrew packaging

`confluence-cli.rb` is the Homebrew formula for this tool.

## Publish as a tap (one-time)

So users can run `brew install ml-lubich/tap/confluence-cli`:

```bash
# 1. Create a PUBLIC repo named exactly `homebrew-tap` under your account:
gh repo create ml-lubich/homebrew-tap --public --description "Homebrew tap for ml-lubich CLI tools"

# 2. Add the formula and push:
git clone https://github.com/ml-lubich/homebrew-tap.git
mkdir -p homebrew-tap/Formula
cp packaging/homebrew/confluence-cli.rb homebrew-tap/Formula/confluence-cli.rb
cd homebrew-tap && git add . && git commit -m "confluence-cli 2.19.0" && git push
```

Then anyone can:

```bash
brew install ml-lubich/tap/confluence-cli
```

## On each release

Bump `url` to the new tag and refresh `sha256`:

```bash
curl -sL https://github.com/ml-lubich/confluence-cli/archive/refs/tags/vX.Y.Z.tar.gz | shasum -a 256
```

Then copy the updated formula into the tap repo and push.

## Install without a tap

You can also install straight from the formula file or from GitHub:

```bash
brew install --formula packaging/homebrew/confluence-cli.rb   # from a checkout
npm install -g ml-lubich/confluence-cli                        # or skip brew entirely
```
