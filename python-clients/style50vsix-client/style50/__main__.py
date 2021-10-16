import argparse
import subprocess
import sys

def main():
    """Main function"""

    args = parse_args(sys.argv[1:])
    print(analyze(args.FILE), sep="")


def analyze(file):
    """Perform style checking using pylint"""

    with subprocess.Popen(['pylint', '-f', 'json', file],stdout=subprocess.PIPE) as proc:
        result = proc.stdout.read()
        return result.decode('utf-8')


def parse_args(args):
    """Arguments parser"""

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "FILE"
    )
    return parser.parse_args(args)


if __name__ == "__main__":
    main()
