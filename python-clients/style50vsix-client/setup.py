import setuptools

setuptools.setup(
    name="Style50 VSIX Client",
    version="1.0.0",
    author="CS50",
    author_email="sysadmins@cs50.harvard.edu",
    description="A companion of the Style50 VSCode extension.",
    url="https://github.com/cs50/stye50.vsix",
    license="GPLv3",
    classifiers=[
        "Programming Language :: Python :: 3.6"
    ],
    packages=["style50"],
    entry_points={
        "console_scripts": [
            "style50-mock=style50.__main__:main"
        ]
    },
    install_requires=["pylint"]
)
