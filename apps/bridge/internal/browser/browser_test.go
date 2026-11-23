package browser

import "testing"

func TestPairPageKeepsTheCode(t *testing.T) {
	got, err := PairPage("https://folderlink.muiz.pk/", "K7QM-2XPA")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://folderlink.muiz.pk/pair?code=K7QM-2XPA" {
		t.Fatalf("got %s", got)
	}
}
