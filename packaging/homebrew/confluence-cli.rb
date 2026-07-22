# Homebrew formula for @ml-lubich/confluence-cli.
#
# To publish this as a tap so users can `brew install ml-lubich/tap/confluence-cli`:
#   1. Create a PUBLIC repo named exactly `homebrew-tap` under your account.
#   2. Copy this file to `Formula/confluence-cli.rb` in that repo and push.
# See packaging/homebrew/README.md for the exact commands.
#
# When you cut a new release, bump `url` to the new tag and update `sha256`
# (curl -sL <url> | shasum -a 256).
class ConfluenceCli < Formula
  desc "Confluence CLI with bulk operations (move/mirror/delete), built for AI agents"
  homepage "https://github.com/ml-lubich/confluence-cli"
  url "https://github.com/ml-lubich/confluence-cli/archive/refs/tags/v2.19.0.tar.gz"
  sha256 "8a90052ab6e327a8c85dd883eb9797ca603f2c1f698d2f4c32a594243c534180"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "2.19.0", shell_output("#{bin}/confluence --version")
  end
end
